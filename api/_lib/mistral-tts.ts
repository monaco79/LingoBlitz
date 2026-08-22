import type { TTSConfig } from './tts-config.ts';

export interface MistralVoice {
  id: string;
  name: string;
  languages: string[];
  gender?: string;
  description?: string;
}

export type TTSErrorCategory =
  | 'disabled'
  | 'configuration'
  | 'timeout'
  | 'rate_limit'
  | 'moderation'
  | 'upstream'
  | 'invalid_response';

const ERROR_MESSAGES: Record<TTSErrorCategory, string> = {
  disabled: 'Mistral TTS is disabled',
  configuration: 'Mistral TTS configuration is invalid',
  timeout: 'Mistral TTS request timed out',
  rate_limit: 'Mistral TTS rate limit',
  moderation: 'Mistral TTS request was rejected',
  upstream: 'Mistral TTS upstream error',
  invalid_response: 'Mistral TTS returned an invalid response',
};

export class TTSError extends Error {
  readonly category: TTSErrorCategory;
  readonly status: number;

  constructor(category: TTSErrorCategory, status: number) {
    super(ERROR_MESSAGES[category]);
    this.name = 'TTSError';
    this.category = category;
    this.status = status;
  }
}

function assertConfig(config: TTSConfig): string {
  if (!config.enabled) {
    throw new TTSError('disabled', 503);
  }

  if (!config.apiKey) {
    throw new TTSError('configuration', 500);
  }

  return config.apiKey;
}

function errorForStatus(status: number): TTSError {
  if (status === 403) {
    return new TTSError('moderation', status);
  }

  if (status === 429) {
    return new TTSError('rate_limit', status);
  }

  return new TTSError('upstream', status || 502);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function requestJson(
  config: TTSConfig,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch | undefined,
): Promise<unknown> {
  const apiKey = assertConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${apiKey}`);

  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(`${config.baseURL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      throw new TTSError('timeout', 504);
    }

    throw new TTSError('upstream', 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw errorForStatus(response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new TTSError('invalid_response', 502);
  }
}

function decodeBase64(value: string): Uint8Array {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TTSError('invalid_response', 502);
  }

  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }

    return bytes;
  } catch {
    throw new TTSError('invalid_response', 502);
  }
}

function parseVoices(payload: unknown): MistralVoice[] {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : null;

  if (!data) {
    throw new TTSError('invalid_response', 502);
  }

  return data.map((voice) => {
    if (!voice || typeof voice !== 'object') {
      throw new TTSError('invalid_response', 502);
    }

    const candidate = voice as Partial<MistralVoice>;
    if (
      typeof candidate.id !== 'string' || !candidate.id.trim()
      || typeof candidate.name !== 'string' || !candidate.name.trim()
      || !Array.isArray(candidate.languages) || !candidate.languages.every((language) => typeof language === 'string')
      || (candidate.gender !== undefined && typeof candidate.gender !== 'string')
      || (candidate.description !== undefined && typeof candidate.description !== 'string')
    ) {
      throw new TTSError('invalid_response', 502);
    }

    return {
      id: candidate.id,
      name: candidate.name,
      languages: candidate.languages,
      ...(candidate.gender === undefined ? {} : { gender: candidate.gender }),
      ...(candidate.description === undefined ? {} : { description: candidate.description }),
    };
  });
}

export async function listPresetVoices(
  config: TTSConfig,
  fetchImpl?: typeof fetch,
): Promise<MistralVoice[]> {
  const payload = await requestJson(config, '/audio/voices?type=preset&limit=1000', { method: 'GET' }, fetchImpl);
  return parseVoices(payload);
}

export async function generateSpeech(
  config: TTSConfig,
  input: { text: string; voiceId: string },
  fetchImpl?: typeof fetch,
): Promise<Uint8Array> {
  const payload = await requestJson(config, '/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      input: input.text,
      voice_id: input.voiceId,
      response_format: 'mp3',
      stream: false,
    }),
  }, fetchImpl);

  if (!payload || typeof payload !== 'object' || typeof (payload as { audio_data?: unknown }).audio_data !== 'string') {
    throw new TTSError('invalid_response', 502);
  }

  return decodeBase64((payload as { audio_data: string }).audio_data);
}
