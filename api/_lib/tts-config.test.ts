import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveTTSConfig } from './tts-config.ts';

test('enables Voxtral with its pinned defaults when a Mistral key is present', () => {
  assert.deepEqual(resolveTTSConfig({ MISTRAL_API_KEY: 'key' }), {
    enabled: true,
    model: 'voxtral-mini-tts-2603',
    apiKey: 'key',
    baseURL: 'https://api.mistral.ai/v1',
  });
});

test('disables Voxtral when explicitly disabled', () => {
  assert.equal(resolveTTSConfig({ TTS_ENABLED: 'false', MISTRAL_API_KEY: 'key' }).enabled, false);
});

test('disables Voxtral without a Mistral key', () => {
  assert.equal(resolveTTSConfig({}).enabled, false);
});

test('allows the Voxtral model to be overridden independently of AI model settings', () => {
  assert.equal(resolveTTSConfig({ MISTRAL_API_KEY: 'key', TTS_MODEL: 'next-model' }).model, 'next-model');
});
