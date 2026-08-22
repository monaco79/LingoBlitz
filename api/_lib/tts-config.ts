export interface TTSConfig {
  enabled: boolean;
  model: string;
  apiKey: string | null;
  baseURL: string;
}

const DEFAULT_MODEL = 'voxtral-mini-tts-2603';
const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

export function resolveTTSConfig(env: NodeJS.ProcessEnv): TTSConfig {
  const apiKey = env.MISTRAL_API_KEY?.trim() || null;

  return {
    enabled: env.TTS_ENABLED?.trim().toLowerCase() !== 'false' && apiKey !== null,
    model: env.TTS_MODEL?.trim() || DEFAULT_MODEL,
    apiKey,
    baseURL: MISTRAL_BASE_URL,
  };
}
