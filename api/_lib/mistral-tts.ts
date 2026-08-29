import type { TTSConfig } from './tts-config';

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
  | 'cancelled'
  | 'timeout'
  | 'rate_limit'
  | 'moderation'
  | 'upstream'
  | 'invalid_response';

const PRESET_VOICE_CACHE_TTL_MS = 15 * 60 * 1_000;

let presetVoicesCache: { voices: MistralVoice[]; expiresAt: number } | null = null;

interface PendingPresetVoices {
  controller: AbortController;
  consumers: number;
  settled: boolean;
  promise: Promise<MistralVoice[]>;
}

let pendingPresetVoices: PendingPresetVoices | null = null;

const ERROR_MESSAGES: Record<TTSErrorCategory, string> = {
  disabled: 'Mistral TTS is disabled',
  configuration: 'Mistral TTS configuration is invalid',
  cancelled: 'Mistral TTS request was cancelled',
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
  externalSignal?: AbortSignal,
): Promise<unknown> {
  if (externalSignal?.aborted) {
    throw new TTSError('cancelled', 499);
  }

  const apiKey = assertConfig(config);
  const controller = new AbortController();
  let externallyAborted = false;
  const cancel = () => {
    externallyAborted = true;
    controller.abort();
  };
  externalSignal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${apiKey}`);

  const abortError = () => externallyAborted || externalSignal?.aborted
    ? new TTSError('cancelled', 499)
    : new TTSError('timeout', 504);

  try {
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(`${config.baseURL}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        throw abortError();
      }

      throw new TTSError('upstream', 502);
    }

    if (!response.ok) {
      throw errorForStatus(response.status);
    }

    if (controller.signal.aborted) {
      throw abortError();
    }

    try {
      const payload = await response.json();
      if (controller.signal.aborted) {
        throw abortError();
      }
      return payload;
    } catch (error) {
      if (error instanceof TTSError) {
        throw error;
      }
      if (isAbortError(error) || controller.signal.aborted) {
        throw abortError();
      }

      throw new TTSError('invalid_response', 502);
    }
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', cancel);
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
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
    ? (payload as { items: unknown[] }).items
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
  signal?: AbortSignal,
): Promise<MistralVoice[]> {
  const payload = await requestJson(
    config,
    '/audio/voices?limit=1000&offset=0',
    { method: 'GET' },
    fetchImpl,
    signal,
  );
  return parseVoices(payload);
}

function consumePendingVoices(
  pending: PendingPresetVoices,
  signal?: AbortSignal,
): Promise<MistralVoice[]> {
  pending.consumers += 1;

  return new Promise<MistralVoice[]>((resolve, reject) => {
    let finished = false;

    const release = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', cancel);
      pending.consumers -= 1;
      if (!pending.settled && pending.consumers === 0) {
        pending.controller.abort();
      }
    };
    const cancel = () => {
      release();
      reject(new TTSError('cancelled', 499));
    };

    if (signal?.aborted) {
      cancel();
      return;
    }

    signal?.addEventListener('abort', cancel, { once: true });
    pending.promise.then(
      (voices) => {
        if (finished) return;
        release();
        resolve(voices);
      },
      (error: unknown) => {
        if (finished) return;
        release();
        reject(error);
      },
    );
  });
}

export async function getCachedPresetVoices(
  config: TTSConfig,
  fetchImpl?: typeof fetch,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<MistralVoice[]> {
  if (signal?.aborted) {
    throw new TTSError('cancelled', 499);
  }

  if (presetVoicesCache && presetVoicesCache.expiresAt > now) {
    return presetVoicesCache.voices;
  }

  if (!pendingPresetVoices) {
    const pending: PendingPresetVoices = {
      controller: new AbortController(),
      consumers: 0,
      settled: false,
      promise: Promise.resolve([] as MistralVoice[]),
    };

    pending.promise = listPresetVoices(config, fetchImpl, pending.controller.signal)
      .then((voices) => {
        presetVoicesCache = { voices, expiresAt: now + PRESET_VOICE_CACHE_TTL_MS };
        return voices;
      })
      .finally(() => {
        pending.settled = true;
        if (pendingPresetVoices === pending) {
          pendingPresetVoices = null;
        }
      });
    pendingPresetVoices = pending;
  }

  return consumePendingVoices(pendingPresetVoices, signal);
}

/** Test-only cache cleanup for isolated module-level cache assertions. */
export function resetPresetVoicesCacheForTests(): void {
  presetVoicesCache = null;
  pendingPresetVoices?.controller.abort();
  pendingPresetVoices = null;
}

export async function generateSpeech(
  config: TTSConfig,
  input: { text: string; voiceId: string },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
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
  }, fetchImpl, signal);

  if (!payload || typeof payload !== 'object' || typeof (payload as { audio_data?: unknown }).audio_data !== 'string') {
    throw new TTSError('invalid_response', 502);
  }

  return decodeBase64((payload as { audio_data: string }).audio_data);
}
