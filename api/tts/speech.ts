import {
  generateSpeech,
  getCachedPresetVoices,
  TTSError,
  voiceSupportsLanguage,
  type MistralVoice,
} from '../_lib/mistral-tts';
import { resolveTTSConfig, type TTSConfig } from '../_lib/tts-config';
import { toMistralLanguageCode } from '../../services/tts/languageConfig';
import type { Language } from '../../types';

export const config = { runtime: 'edge' };

type VoiceReader = (config: TTSConfig, signal?: AbortSignal) => Promise<MistralVoice[]>;
type SpeechGenerator = (
  config: TTSConfig,
  input: { text: string; voiceId: string },
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export interface SpeechTelemetryEntry {
  requestId: string;
  provider: 'mistral';
  statusCategory: string;
  language: string | null;
  model: string | null;
  durationMs: number;
  characterCount: number;
}

export interface SpeechHandlerDependencies {
  resolveConfig?: () => TTSConfig;
  getCachedPresetVoices?: VoiceReader;
  listPresetVoices?: VoiceReader;
  generateSpeech?: SpeechGenerator;
  log?: (entry: SpeechTelemetryEntry) => void;
  createRequestId?: () => string;
  now?: () => number;
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
    case 'cancelled':
      return errorResponse(499, 'request_cancelled', 'Text-to-speech request was cancelled');
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TTSError('cancelled', 499);
  }
}

function defaultLog(entry: SpeechTelemetryEntry): void {
  console.info(JSON.stringify(entry));
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
    ?? ((ttsConfig: TTSConfig, signal?: AbortSignal) => (
      getCachedPresetVoices(ttsConfig, undefined, Date.now(), signal)
    ));
  const synthesize = dependencies.generateSpeech
    ?? ((ttsConfig: TTSConfig, input: { text: string; voiceId: string }, signal?: AbortSignal) => (
      generateSpeech(ttsConfig, input, undefined, signal)
    ));
  const log = dependencies.log ?? defaultLog;
  const now = dependencies.now ?? Date.now;
  const createRequestId = dependencies.createRequestId ?? (() => crypto.randomUUID());

  return async function handler(request: Request): Promise<Response> {
    let startedAt = 0;
    try {
      startedAt = now();
    } catch {
      // Telemetry helpers must not alter request handling.
    }
    let requestId = 'unavailable';
    try {
      requestId = createRequestId();
    } catch {
      // A safe placeholder keeps telemetry structured if ID creation fails.
    }
    let ttsConfig: TTSConfig | null = null;
    let languageCode: string | null = null;
    let characterCount = 0;

    const finish = (response: Response, statusCategory: string): Response => {
      let durationMs = 0;
      try {
        durationMs = Math.max(0, now() - startedAt);
      } catch {
        // Keep the response stable if a test or platform clock fails.
      }

      try {
        log({
          requestId,
          provider: 'mistral',
          statusCategory,
          language: languageCode,
          model: ttsConfig?.model ?? null,
          durationMs,
          characterCount,
        });
      } catch {
        // Logging must not alter the client response.
      }

      return response;
    };

    if (request.method !== 'POST') {
      return finish(errorResponse(405, 'method_not_allowed', 'Method not allowed'), 'method_not_allowed');
    }

    try {
      throwIfAborted(request.signal);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return finish(invalidRequestResponse(), 'invalid_request');
      }

      throwIfAborted(request.signal);

      if (!isSpeechRequest(body)) {
        return finish(invalidRequestResponse(), 'invalid_request');
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
        return finish(invalidRequestResponse(), 'invalid_request');
      }

      ttsConfig = resolveConfig();
      if (!ttsConfig.enabled) {
        return finish(errorResponse(503, 'tts_unavailable', 'Text-to-speech is unavailable'), 'disabled');
      }

      const voices = await readVoices(ttsConfig, request.signal);
      throwIfAborted(request.signal);
      const selectedVoice = voices.find((voice) => voice.id === voiceId);
      if (!selectedVoice || !voiceSupportsLanguage(selectedVoice, languageCode)) {
        return finish(invalidRequestResponse(), 'invalid_request');
      }

      throwIfAborted(request.signal);
      const audio = await synthesize(ttsConfig, { text, voiceId }, request.signal);
      throwIfAborted(request.signal);
      return finish(new Response(audio, {
        headers: {
          'content-type': 'audio/mpeg',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'x-tts-model': ttsConfig.model,
        },
      }), 'success');
    } catch (error) {
      const safeError = error instanceof TTSError
        ? error
        : request.signal.aborted || isAbortError(error)
          ? new TTSError('cancelled', 499)
          : null;
      const response = safeError
        ? ttsErrorResponse(safeError)
        : errorResponse(502, 'tts_upstream_error', 'Text-to-speech service failed');
      return finish(response, safeError?.category ?? 'unexpected');
    }
  };
}

export default createSpeechHandler();
