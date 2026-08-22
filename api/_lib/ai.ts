import { OpenAI } from 'openai';

import { resolveAIConfig } from './ai-config';

export function getAIClient() {
  const config = resolveAIConfig(process.env);
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });

  return {
    client,
    model: config.model,
    provider: config.provider,
  };
}
