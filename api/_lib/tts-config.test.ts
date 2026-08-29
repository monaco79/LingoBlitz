import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveTTSConfig } from './tts-config.ts';

test('documents the server-only Voxtral environment contract', () => {
  const example = readFileSync(fileURLToPath(new URL('../../.env.example', import.meta.url)), 'utf8');
  const variableNames = example
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((name): name is string => name !== undefined);

  assert.deepEqual(
    variableNames.filter((name) => name.startsWith('TTS_')),
    ['TTS_ENABLED', 'TTS_MODEL'],
  );
  assert.equal(variableNames.includes('MISTRAL_API_KEY'), true);
  assert.equal(variableNames.some((name) => name.startsWith('VITE_MISTRAL_')), false);
});

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
