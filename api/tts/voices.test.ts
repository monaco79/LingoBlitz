import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVoicesHandler } from './voices.ts';
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
  { id: 'global-1', name: 'Multilingual', languages: [] },
  { id: 'en-1', name: 'James', languages: ['en'], description: 'English preset' },
  { id: 'custom-looking-id', name: 'Do not expose for German', languages: ['fr'] },
];

test('returns only preset voices compatible with the requested language', async () => {
  const handler = createVoicesHandler({
    resolveConfig: () => enabledConfig,
    listPresetVoices: async () => presetVoices,
  });

  const response = await handler(new Request(
    'https://example.test/api/tts/voices?language=German',
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    voices: [
      { id: 'de-1', name: 'Anna', languages: ['de'], gender: 'female' },
      { id: 'global-1', name: 'Multilingual', languages: [] },
    ],
  });
});

test('rejects a missing or unsupported language', async () => {
  const handler = createVoicesHandler({
    resolveConfig: () => enabledConfig,
    listPresetVoices: async () => presetVoices,
  });

  for (const url of [
    'https://example.test/api/tts/voices',
    'https://example.test/api/tts/voices?language=Japanese',
  ]) {
    const response = await handler(new Request(url));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'invalid_request', message: 'A supported language is required' },
    });
  }
});

test('reports unavailable TTS when it is disabled', async () => {
  const handler = createVoicesHandler({
    resolveConfig: () => ({ ...enabledConfig, enabled: false }),
    listPresetVoices: async () => presetVoices,
  });

  const response = await handler(new Request(
    'https://example.test/api/tts/voices?language=German',
  ));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'tts_unavailable', message: 'Text-to-speech is unavailable' },
  });
});

test('logs safe upstream diagnostics without exposing secrets', async () => {
  const messages: unknown[] = [];
  const handler = createVoicesHandler({
    resolveConfig: () => enabledConfig,
    listPresetVoices: async () => {
      throw new TTSError('upstream', 404);
    },
    log: (entry) => { messages.push(entry); },
  });

  const response = await handler(new Request(
    'https://example.test/api/tts/voices?language=German',
  ));

  assert.equal(response.status, 502);
  assert.deepEqual(messages, [{
    provider: 'mistral',
    endpoint: 'voices',
    statusCategory: 'upstream',
    upstreamStatus: 404,
    language: 'de',
  }]);
  assert.equal(JSON.stringify(messages).includes(enabledConfig.apiKey!), false);
});
