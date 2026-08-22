import {
  generateSpeech,
  getCachedPresetVoices,
  listPresetVoices,
  TTSError,
  type MistralVoice,
} from '../_lib/mistral-tts.ts';
import { resolveTTSConfig, type TTSConfig } from '../_lib/tts-config.ts';
import { toMistralLanguageCode } from '../../services/tts/languageConfig.ts';
import type { Language } from '../../types.ts';

export const config = { runtime: 'edge' };

type VoiceReader = (config: TTSConfig) => Promise<MistralVoice[]>;
type SpeechGenerator = (config: TTSConfig, input: { text: string; voiceId: string }) => Promise<Uint8Array>;

export interface SpeechHandlerDependencies {
  resolveConfig?: () => TTSConfig;
  getCachedPresetVoices?: VoiceReader;
  listPresetVoices?: VoiceReader;
  generateSpeech?: SpeechGenerator;
  log?: (entry: {
    category: string;
    status: number;
    model: string | null;
    language: string | null;
    durationMs: number;
    characterCount: number;
  }) => void;
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function invalidRequestResponse(): Response {
  return errorResponse(400, 'invalid_request', 'Invalid speech request');
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

function isSpeechRequest(value: unknown): value is { text: string; language: string; voiceId: string } {
  return !!value
    && typeof value === 'object'
    && typeof (value as { text?: unknown }).text === 'string'
    && typeof (value as { language?: unknown }).language === 'string'
    && typeof (value as { voiceId?: unknown }).voiceId === 'string';
}

export function createSpeechHandler(dependencies: SpeechHandlerDependencies = {}) {
  const resolveConfig = dependencies.resolveConfig ?? (() => resolveTTSConfig(process.env));
  const readVoices = dependencies.getCachedPresetVoices
    ?? dependencies.listPresetVoices
    ?? getCachedPresetVoices;
  const synthesize = dependencies.generateSpeech ?? generateSpeech;

  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Method not allowed');
    }

    const startedAt = Date.now();
    let ttsConfig: TTSConfig | null = null;
    let languageCode: string | null = null;
    let characterCount = 0;

    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return invalidRequestResponse();
      }

      if (!isSpeechRequest(body)) {
        return invalidRequestResponse();
      }

      const text = body.text.trim();
      const voiceId = body.voiceId.trim();
      characterCount = text.length;
      languageCode = toMistralLanguageCode(body.language as Language);

      if (
        !text
        || body.text.length > 2_000
        || text.split(/\s+/).length > 250
        || !languageCode
        || !voiceId
      ) {
        return invalidRequestResponse();
      }

      ttsConfig = resolveConfig();
      if (!ttsConfig.enabled) {
        return errorResponse(503, 'tts_unavailable', 'Text-to-speech is unavailable');
      }

      const voices = await readVoices(ttsConfig);
      const selectedVoice = voices.find((voice) => voice.id === voiceId);
      if (!selectedVoice || !selectedVoice.languages.some((voiceLanguage) => voiceLanguage.toLowerCase() === languageCode.toLowerCase())) {
        return invalidRequestResponse();
      }

      const audio = await synthesize(ttsConfig, { text, voiceId });
      return new Response(audio, {
        headers: {
          'content-type': 'audio/mpeg',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      const response = error instanceof TTSError
        ? ttsErrorResponse(error)
        : errorResponse(502, 'tts_upstream_error', 'Text-to-speech service failed');

      try {
        dependencies.log?.({
          category: error instanceof TTSError ? error.category : 'unexpected',
          status: response.status,
          model: ttsConfig?.model ?? null,
          language: languageCode,
          durationMs: Date.now() - startedAt,
          characterCount,
        });
      } catch {
        // Logging must not alter the client response.
      }

      return response;
    }
  };
}

export default createSpeechHandler();
