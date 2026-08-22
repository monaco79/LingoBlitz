import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSpeechHandler } from './speech.ts';
import { TTSError, type MistralVoice } from '../_lib/mistral-tts.ts';
import type { TTSConfig } from '../_lib/tts-config.ts';

const enabledConfig: TTSConfig = {
  enabled: true,
  model: 'voxtral-mini-tts-2603',
  apiKey: 'test-secret-key',
  baseURL: 'https://api.mistral.ai/v1',
};

const presetVoices: MistralVoice[] = [
  { id: 'de-1', name: 'Anna', languages: ['de'], gender: 'female' },
  { id: 'en-1', name: 'James', languages: ['en'] },
];

function request(body: unknown): Request {
  return new Request('https://example.test/api/tts/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createHandler(overrides: Partial<Parameters<typeof createSpeechHandler>[0]> = {}) {
  return createSpeechHandler({
    resolveConfig: () => enabledConfig,
    getCachedPresetVoices: async () => presetVoices,
    generateSpeech: async () => new Uint8Array([1, 2, 3]),
    ...overrides,
  });
}

test('rejects methods other than POST', async () => {
  const response = await createHandler()(new Request('https://example.test/api/tts/speech'));

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), {
    error: { code: 'method_not_allowed', message: 'Method not allowed' },
  });
});

test('rejects invalid text, language, and voice inputs', async () => {
  const handler = createHandler();
  const cases = [
    { text: '', language: 'German', voiceId: 'de-1' },
    { text: 'a'.repeat(2_001), language: 'German', voiceId: 'de-1' },
    { text: Array.from({ length: 251 }, () => 'word').join(' '), language: 'German', voiceId: 'de-1' },
    { text: 'Hello', language: 'Japanese', voiceId: 'de-1' },
    { text: 'Hello', language: 'German', voiceId: '  ' },
  ];

  for (const body of cases) {
    const response = await handler(request(body));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'invalid_request', message: 'Invalid speech request' },
    });
  }
});

test('rejects voices missing from presets or incompatible with the requested language', async () => {
  const handler = createHandler();

  for (const body of [
    { text: 'Hallo', language: 'German', voiceId: 'missing' },
    { text: 'Hallo', language: 'German', voiceId: 'en-1' },
  ]) {
    const response = await handler(request(body));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'invalid_request', message: 'Invalid speech request' },
    });
  }
});

test('returns MP3 bytes with private no-store response headers', async () => {
  const expectedAudio = new Uint8Array([0, 255, 42]);
  const handler = createHandler({ generateSpeech: async () => expectedAudio });

  const response = await handler(request({ text: 'Hallo', language: 'German', voiceId: 'de-1' }));

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expectedAudio);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('maps TTS moderation, rate limit, configuration, and timeout failures safely', async () => {
  const cases: Array<{ error: TTSError; status: number; code: string; message: string }> = [
    { error: new TTSError('moderation', 403), status: 403, code: 'content_rejected', message: 'Text-to-speech request was rejected' },
    { error: new TTSError('rate_limit', 429), status: 429, code: 'rate_limited', message: 'Text-to-speech is temporarily rate limited' },
    { error: new TTSError('configuration', 500), status: 503, code: 'tts_unavailable', message: 'Text-to-speech is unavailable' },
    { error: new TTSError('timeout', 504), status: 504, code: 'tts_timeout', message: 'Text-to-speech request timed out' },
  ];

  for (const expected of cases) {
    const handler = createHandler({ generateSpeech: async () => { throw expected.error; } });
    const response = await handler(request({ text: 'Hallo', language: 'German', voiceId: 'de-1' }));

    assert.equal(response.status, expected.status);
    assert.deepEqual(await response.json(), {
      error: { code: expected.code, message: expected.message },
    });
  }
});

test('reports disabled TTS as unavailable', async () => {
  const handler = createHandler({ resolveConfig: () => ({ ...enabledConfig, enabled: false }) });

  const response = await handler(request({ text: 'Hallo', language: 'German', voiceId: 'de-1' }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'tts_unavailable', message: 'Text-to-speech is unavailable' },
  });
});

test('does not expose spoken text or secrets when an unexpected failure occurs', async () => {
  const spokenText = 'private spoken phrase';
  const secret = 'test-secret-key';
  const logs: unknown[] = [];
  const handler = createHandler({
    generateSpeech: async () => { throw new Error(`${secret}: ${spokenText}`); },
    log: (entry) => { logs.push(entry); },
  });

  const response = await handler(request({ text: spokenText, language: 'German', voiceId: 'de-1' }));
  const body = JSON.stringify(await response.json());

  assert.equal(response.status, 502);
  assert.equal(body.includes(spokenText), false);
  assert.equal(body.includes(secret), false);
  assert.equal(JSON.stringify(logs).includes(spokenText), false);
  assert.equal(JSON.stringify(logs).includes(secret), false);
});
