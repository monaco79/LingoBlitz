import * as assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import {
  generateSpeech,
  getCachedPresetVoices,
  listPresetVoices,
  resetPresetVoicesCacheForTests,
  TTSError,
} from './mistral-tts.ts';
import type { TTSConfig } from './tts-config.ts';

const config: TTSConfig = {
  enabled: true,
  model: 'voxtral-mini-tts-2603',
  apiKey: 'test-secret-key',
  baseURL: 'https://api.mistral.ai/v1',
};

function fetchStub(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

test('lists all saved voices with Mistral bearer authentication', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const voices = await listPresetVoices(config, (async (input, init) => {
    request = { input, init };
    return Response.json({
      items: [{
        id: 'voice-1',
        name: 'Voice One',
        languages: ['en'],
        gender: null,
        description: null,
      }],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
  }) as typeof fetch);

  assert.deepEqual(voices, [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }]);
  assert.equal(request?.input, 'https://api.mistral.ai/v1/audio/voices?limit=10&offset=0&type=all');
  assert.equal(request?.init?.method, 'GET');
  assert.equal((request?.init?.headers as Headers).get('authorization'), 'Bearer test-secret-key');
});

test('caches the complete preset voice list for fifteen minutes', async () => {
  resetPresetVoicesCacheForTests();
  let upstreamCalls = 0;
  const fetchImpl = (async () => {
    upstreamCalls += 1;
    return Response.json({ items: [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }] });
  }) as typeof fetch;

  try {
    const first = await getCachedPresetVoices(config, fetchImpl, 1_000);
    const second = await getCachedPresetVoices(config, fetchImpl, 1_000 + (15 * 60 * 1_000) - 1);
    const refreshed = await getCachedPresetVoices(config, fetchImpl, 1_000 + (15 * 60 * 1_000));

    assert.deepEqual(first, [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }]);
    assert.deepEqual(second, first);
    assert.deepEqual(refreshed, first);
    assert.equal(upstreamCalls, 2);
  } finally {
    resetPresetVoicesCacheForTests();
  }
});

test('promise-coalesces concurrent cold preset voice fills', async () => {
  resetPresetVoicesCacheForTests();
  let upstreamCalls = 0;
  let resolveResponse!: (response: Response) => void;
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const fetchImpl = (async () => {
    upstreamCalls += 1;
    return responsePromise;
  }) as typeof fetch;

  try {
    const first = getCachedPresetVoices(config, fetchImpl, 1_000);
    const second = getCachedPresetVoices(config, fetchImpl, 1_000);
    assert.equal(upstreamCalls, 1);
    resolveResponse(Response.json({ items: [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }] }));
    assert.deepEqual(await first, [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }]);
    assert.deepEqual(await second, await first);
  } finally {
    resetPresetVoicesCacheForTests();
  }
});

test('classifies an external abort before preset validation without calling upstream', async () => {
  const controller = new AbortController();
  let upstreamCalls = 0;
  const fetchImpl = (async () => {
    upstreamCalls += 1;
    return Response.json({ items: [] });
  }) as typeof fetch;
  controller.abort();

  await assert.rejects(
    listPresetVoices(config, fetchImpl, controller.signal),
    (error: unknown) => error instanceof TTSError && error.category === 'cancelled' && error.status === 499,
  );
  assert.equal(upstreamCalls, 0);
});

test('propagates and safely classifies external aborts during preset validation', async () => {
  const controller = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  const validation = listPresetVoices(config, (async (_input, init) => {
    upstreamSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      upstreamSignal?.addEventListener('abort', () => reject(new DOMException('private provider body', 'AbortError')));
      setTimeout(() => reject(new DOMException('safety timeout', 'AbortError')), 0);
    });
  }) as typeof fetch, controller.signal);

  controller.abort();

  await assert.rejects(
    validation,
    (error: unknown) => error instanceof TTSError
      && error.category === 'cancelled'
      && error.status === 499
      && !error.message.includes('private provider body'),
  );
  assert.equal(upstreamSignal?.aborted, true);
});

test('propagates and safely classifies external aborts during speech generation', async () => {
  const controller = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  const generation = generateSpeech(config, { text: 'Hello', voiceId: 'voice-1' }, (async (_input, init) => {
    upstreamSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      upstreamSignal?.addEventListener('abort', () => reject(new DOMException('private provider body', 'AbortError')));
      setTimeout(() => reject(new DOMException('safety timeout', 'AbortError')), 0);
    });
  }) as typeof fetch, controller.signal);

  controller.abort();

  await assert.rejects(
    generation,
    (error: unknown) => error instanceof TTSError && error.category === 'cancelled' && error.status === 499,
  );
  assert.equal(upstreamSignal?.aborted, true);
});

test('generates MP3 speech and decodes the returned Base64 audio', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const audio = await generateSpeech(config, { text: 'Hello', voiceId: 'voice-1' }, (async (input, init) => {
    request = { input, init };
    return Response.json({ audio_data: 'aGk=' });
  }) as typeof fetch);

  assert.deepEqual(audio, new Uint8Array([104, 105]));
  assert.equal(request?.input, 'https://api.mistral.ai/v1/audio/speech');
  assert.equal(request?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(request?.init?.body as string), {
    model: 'voxtral-mini-tts-2603',
    input: 'Hello',
    voice_id: 'voice-1',
    response_format: 'mp3',
    stream: false,
  });
  assert.equal((request?.init?.headers as Headers).get('authorization'), 'Bearer test-secret-key');
  assert.equal((request?.init?.headers as Headers).get('content-type'), 'application/json');
});

test('maps forbidden responses to moderation errors without exposing upstream data', async () => {
  await assert.rejects(
    generateSpeech(config, { text: 'Hello', voiceId: 'voice-1' }, fetchStub(Response.json({ error: 'test-secret-key raw body' }, { status: 403 }))),
    (error: unknown) => {
      assert.ok(error instanceof TTSError);
      assert.equal(error.category, 'moderation');
      assert.equal(error.status, 403);
      assert.equal(error.message.includes('test-secret-key'), false);
      assert.equal(error.message.includes('raw body'), false);
      return true;
    },
  );
});

test('maps rate limits to safe rate-limit errors', async () => {
  await assert.rejects(
    listPresetVoices(config, fetchStub(Response.json({ error: 'test-secret-key raw body' }, { status: 429 }))),
    (error: unknown) => {
      assert.ok(error instanceof TTSError);
      assert.equal(error.category, 'rate_limit');
      assert.equal(error.status, 429);
      assert.equal(error.message.includes('test-secret-key'), false);
      assert.equal(error.message.includes('raw body'), false);
      return true;
    },
  );
});

test('maps aborted fetches to timeout errors', async () => {
  const abortError = new DOMException('provider message test-secret-key', 'AbortError');

  await assert.rejects(
    listPresetVoices(config, (async () => { throw abortError; }) as typeof fetch),
    (error: unknown) => {
      assert.ok(error instanceof TTSError);
      assert.equal(error.category, 'timeout');
      assert.equal(error.status, 504);
      assert.equal(error.message.includes('test-secret-key'), false);
      return true;
    },
  );
});

test('keeps the timeout active while an otherwise successful JSON body stalls', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  let signal: AbortSignal | undefined;
  let rejectBody: ((reason?: unknown) => void) | undefined;
  let bodyParsingStarted: (() => void) | undefined;
  const bodyParsing = new Promise<void>((resolve) => {
    bodyParsingStarted = resolve;
  });
  const stalledResponse = {
    ok: true,
    status: 200,
    json: () => new Promise((_, reject) => {
      rejectBody = reject;
      signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
      bodyParsingStarted?.();
    }),
  } as Response;

  try {
    const voices = listPresetVoices(config, (async (_input, init) => {
      signal = init?.signal as AbortSignal;
      return stalledResponse;
    }) as typeof fetch);

    await bodyParsing;
    mock.timers.tick(20_000);
    const aborted = signal?.aborted;

    if (!aborted) {
      rejectBody?.(new Error('test cleanup'));
    }

    await assert.rejects(voices, (error: unknown) => {
      assert.ok(error instanceof TTSError);
      assert.equal(error.category, 'timeout');
      assert.equal(error.status, 504);
      return true;
    });
    assert.equal(aborted, true);
  } finally {
    mock.timers.reset();
  }
});

test('rejects invalid JSON and Base64 audio with safe invalid-response errors', async () => {
  const invalidJson = new Response('{', { headers: { 'content-type': 'application/json' } });

  for (const response of [invalidJson, Response.json({ audio_data: 'not@base64' })]) {
    await assert.rejects(
      generateSpeech(config, { text: 'Hello', voiceId: 'voice-1' }, fetchStub(response)),
      (error: unknown) => {
        assert.ok(error instanceof TTSError);
        assert.equal(error.category, 'invalid_response');
        assert.equal(error.message.includes('test-secret-key'), false);
        return true;
      },
    );
  }
});

test('rejects voice records missing required Mistral fields', async () => {
  await assert.rejects(
    listPresetVoices(config, fetchStub(Response.json({ items: [{ id: 'voice-1', name: '', languages: ['en'] }] }))),
    (error: unknown) => error instanceof TTSError && error.category === 'invalid_response',
  );
});
