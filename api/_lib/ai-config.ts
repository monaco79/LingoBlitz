export type AIProvider = 'openai' | 'mistral';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseURL: string | undefined;
}

const PROVIDER_DEFAULTS: Record<AIProvider, { model: string; keyName: string; baseURL?: string }> = {
  openai: {
    model: 'gpt-4o',
    keyName: 'OPENAI_API_KEY',
  },
  mistral: {
    model: 'mistral-large-latest',
    keyName: 'MISTRAL_API_KEY',
    baseURL: 'https://api.mistral.ai/v1',
  },
};

export function resolveAIConfig(env: NodeJS.ProcessEnv): AIConfig {
  const providerName = env.AI_PROVIDER?.trim().toLowerCase() || 'openai';

  if (providerName !== 'openai' && providerName !== 'mistral') {
    throw new Error(`Unsupported AI_PROVIDER: ${providerName}`);
  }

  const provider = providerName as AIProvider;
  const defaults = PROVIDER_DEFAULTS[provider];
  const apiKey = env[defaults.keyName]?.trim();

  if (!apiKey) {
    throw new Error(`${defaults.keyName} is required when AI_PROVIDER=${provider}`);
  }

  return {
    provider,
    model: env.AI_MODEL?.trim() || defaults.model,
    apiKey,
    baseURL: defaults.baseURL,
  };
}
