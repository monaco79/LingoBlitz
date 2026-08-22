import * as assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { generateSpeech, listPresetVoices, TTSError } from './mistral-tts.ts';
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

test('lists preset voices with Mistral bearer authentication', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const voices = await listPresetVoices(config, (async (input, init) => {
    request = { input, init };
    return Response.json({ data: [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }] });
  }) as typeof fetch);

  assert.deepEqual(voices, [{ id: 'voice-1', name: 'Voice One', languages: ['en'] }]);
  assert.equal(request?.input, 'https://api.mistral.ai/v1/audio/voices?type=preset&limit=1000');
  assert.equal(request?.init?.method, 'GET');
  assert.equal((request?.init?.headers as Headers).get('authorization'), 'Bearer test-secret-key');
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
    listPresetVoices(config, fetchStub(Response.json({ data: [{ id: 'voice-1', name: '', languages: ['en'] }] }))),
    (error: unknown) => error instanceof TTSError && error.category === 'invalid_response',
  );
});
