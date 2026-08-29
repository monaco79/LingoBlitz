import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveAIConfig } from './ai-config.ts';

test('uses OpenAI defaults when no provider is configured', () => {
  const config = resolveAIConfig({ OPENAI_API_KEY: 'openai-key' });

  assert.deepEqual(config, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'openai-key',
    baseURL: undefined,
  });
});

test('uses the Mistral endpoint and the accessible Large alias when selected', () => {
  const config = resolveAIConfig({
    AI_PROVIDER: 'mistral',
    MISTRAL_API_KEY: 'mistral-key',
  });

  assert.deepEqual(config, {
    provider: 'mistral',
    model: 'mistral-large-latest',
    apiKey: 'mistral-key',
    baseURL: 'https://api.mistral.ai/v1',
  });
});

test('allows the model to change without changing provider code', () => {
  const config = resolveAIConfig({
    AI_PROVIDER: 'mistral',
    AI_MODEL: 'mistral-small-2603',
    MISTRAL_API_KEY: 'mistral-key',
  });

  assert.equal(config.model, 'mistral-small-2603');
});

test('rejects a missing API key for the selected provider', () => {
  assert.throws(
    () => resolveAIConfig({ AI_PROVIDER: 'mistral' }),
    /MISTRAL_API_KEY is required when AI_PROVIDER=mistral/,
  );
});

test('rejects unsupported providers instead of silently falling back', () => {
  assert.throws(
    () => resolveAIConfig({ AI_PROVIDER: 'unknown', OPENAI_API_KEY: 'key' }),
    /Unsupported AI_PROVIDER: unknown/,
  );
});
