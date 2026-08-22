import type { Language } from '../../types';
import {
  TTSAdapterError,
  type SpeechSegment,
  type TTSAdapterErrorCategory,
  type TTSVoiceOption,
} from './types';

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const safeError = (category: TTSAdapterErrorCategory): TTSAdapterError =>
  new TTSAdapterError(category, 'Voxtral request failed');

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError')
  || (error instanceof Error && error.name === 'AbortError');

const errorCategory = (status: number, code: string | null): TTSAdapterErrorCategory => {
  if (status === 403 || code === 'content_rejected') return 'moderation';
  if (status === 429 || code === 'rate_limited') return 'rate_limit';
  if (status === 504 || code === 'tts_timeout') return 'timeout';
  if (status === 400 || status === 503 || code === 'invalid_request' || code === 'tts_unavailable') {
    return 'configuration';
  }
  return 'upstream';
};

const readErrorCode = async (response: Response): Promise<string | null> => {
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') return null;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== 'object') return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
};

const request = async (
  fetchImpl: FetchImplementation,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> => {
  if (init.signal?.aborted) {
    throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
  }

  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch (error) {
    if (isAbortError(error) || init.signal?.aborted) {
      throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
    }
    throw safeError('upstream');
  }

  if (init.signal?.aborted) {
    throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
  }

  if (!response.ok) {
    throw safeError(errorCategory(response.status, await readErrorCode(response)));
  }
  return response;
};

const parseVoices = (payload: unknown): TTSVoiceOption[] => {
  const voices = payload && typeof payload === 'object' && Array.isArray((payload as { voices?: unknown }).voices)
    ? (payload as { voices: unknown[] }).voices
    : null;

  if (!voices) {
    throw new TTSAdapterError('upstream', 'Voxtral returned an invalid voice list');
  }

  return voices.map((voice) => {
    if (!voice || typeof voice !== 'object') {
      throw new TTSAdapterError('upstream', 'Voxtral returned an invalid voice list');
    }
    const candidate = voice as { id?: unknown; name?: unknown; languages?: unknown };
    if (
      typeof candidate.id !== 'string' || !candidate.id
      || typeof candidate.name !== 'string' || !candidate.name
      || !Array.isArray(candidate.languages)
      || !candidate.languages.every((language) => typeof language === 'string')
    ) {
      throw new TTSAdapterError('upstream', 'Voxtral returned an invalid voice list');
    }

    return {
      id: candidate.id,
      name: candidate.name,
      displayName: candidate.name,
      provider: 'voxtral',
      languages: candidate.languages,
    };
  });
};

export const createVoxtralApi = (fetchImpl: FetchImplementation) => ({
  async fetchVoxtralVoices(language: Language, signal?: AbortSignal): Promise<TTSVoiceOption[]> {
    const response = await request(fetchImpl, `/api/tts/voices?language=${encodeURIComponent(language)}`, {
      method: 'GET',
      signal,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
      }
      throw new TTSAdapterError('upstream', 'Voxtral returned an invalid voice list');
    }
    if (signal?.aborted) {
      throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
    }
    return parseVoices(payload);
  },

  async fetchVoxtralAudio(
    segment: SpeechSegment,
    language: Language,
    voiceId: string,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const response = await request(fetchImpl, '/api/tts/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: segment.spokenText, language, voiceId }),
      signal,
    });

    if (response.headers.get('content-type')?.toLowerCase() !== 'audio/mpeg') {
      throw new TTSAdapterError('invalid_audio', 'Voxtral returned invalid audio');
    }

    let audio: Blob;
    try {
      audio = await response.blob();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
      }
      throw new TTSAdapterError('invalid_audio', 'Voxtral returned invalid audio');
    }
    if (signal?.aborted) {
      throw new TTSAdapterError('cancelled', 'Voxtral request was cancelled');
    }
    if (audio.size === 0 || audio.type.toLowerCase() !== 'audio/mpeg') {
      throw new TTSAdapterError('invalid_audio', 'Voxtral returned invalid audio');
    }
    return audio;
  },
});

export const fetchVoxtralVoices = (
  language: Language,
  signal?: AbortSignal,
): Promise<TTSVoiceOption[]> => createVoxtralApi(fetch).fetchVoxtralVoices(language, signal);

export const fetchVoxtralAudio = (
  segment: SpeechSegment,
  language: Language,
  voiceId: string,
  signal?: AbortSignal,
): Promise<Blob> => createVoxtralApi(fetch).fetchVoxtralAudio(segment, language, voiceId, signal);
