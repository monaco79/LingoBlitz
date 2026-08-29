import { getCachedPresetVoices, TTSError, type MistralVoice } from '../_lib/mistral-tts';
import { resolveTTSConfig, type TTSConfig } from '../_lib/tts-config';
import { toMistralLanguageCode } from '../../services/tts/languageConfig';
import type { Language } from '../../types';

export const config = { runtime: 'edge' };

type VoiceReader = (config: TTSConfig) => Promise<MistralVoice[]>;

export interface VoicesTelemetryEntry {
  provider: 'mistral';
  endpoint: 'voices';
  statusCategory: string;
  upstreamStatus: number | null;
  language: string | null;
}

export interface VoicesHandlerDependencies {
  resolveConfig?: () => TTSConfig;
  getCachedPresetVoices?: VoiceReader;
  listPresetVoices?: VoiceReader;
  log?: (entry: VoicesTelemetryEntry) => void;
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function defaultLog(entry: VoicesTelemetryEntry): void {
  console.info(JSON.stringify(entry));
}

function ttsErrorResponse(error: TTSError): Response {
  switch (error.category) {
    case 'moderation':
      return errorResponse(403, 'content_rejected', 'Text-to-speech request was rejected');
    case 'rate_limit':
      return errorResponse(429, 'rate_limited', 'Text-to-speech is temporarily rate limited');
    case 'timeout':
      return errorResponse(504, 'tts_timeout', 'Text-to-speech request timed out');
    case 'disabled':
    case 'configuration':
      return errorResponse(503, 'tts_unavailable', 'Text-to-speech is unavailable');
    default:
      return errorResponse(502, 'tts_upstream_error', 'Text-to-speech service failed');
  }
}

export function createVoicesHandler(dependencies: VoicesHandlerDependencies = {}) {
  const resolveConfig = dependencies.resolveConfig ?? (() => resolveTTSConfig(process.env));
  const readVoices = dependencies.getCachedPresetVoices
    ?? dependencies.listPresetVoices
    ?? getCachedPresetVoices;
  const log = dependencies.log ?? defaultLog;

  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return errorResponse(405, 'method_not_allowed', 'Method not allowed');
    }

    const language = new URL(request.url).searchParams.get('language');
    const languageCode = language ? toMistralLanguageCode(language as Language) : null;

    if (!languageCode) {
      return errorResponse(400, 'invalid_request', 'A supported language is required');
    }

    const ttsConfig = resolveConfig();
    if (!ttsConfig.enabled) {
      return errorResponse(503, 'tts_unavailable', 'Text-to-speech is unavailable');
    }

    try {
      const voices = await readVoices(ttsConfig);
      const compatibleVoices = voices
        .filter((voice) => voice.languages.some((voiceLanguage) => voiceLanguage.toLowerCase() === languageCode.toLowerCase()))
        .map((voice) => ({
          id: voice.id,
          name: voice.name,
          languages: voice.languages,
          ...(voice.gender === undefined ? {} : { gender: voice.gender }),
          ...(voice.description === undefined ? {} : { description: voice.description }),
        }));

      return json({ voices: compatibleVoices });
    } catch (error) {
      try {
        log({
          provider: 'mistral',
          endpoint: 'voices',
          statusCategory: error instanceof TTSError ? error.category : 'unexpected',
          upstreamStatus: error instanceof TTSError ? error.status : null,
          language: languageCode,
        });
      } catch {
        // Diagnostics must never alter the client response.
      }

      if (error instanceof TTSError) {
        return ttsErrorResponse(error);
      }

      return errorResponse(502, 'tts_upstream_error', 'Text-to-speech service failed');
    }
  };
}

export default createVoicesHandler();
