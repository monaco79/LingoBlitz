import type {
  Language,
  TTSProvider,
  TTSSettings,
} from '../types';
import { AudioCache } from './tts/audioCache';
import { BrowserSpeechAdapter } from './tts/browserAdapter';
import {
  PlaybackController,
  type PlaybackRequest,
  type PlaybackSnapshot,
} from './tts/playbackController';
import { createSpeechSegments } from './tts/textSegments';
import { TTSAdapterError, type SpeechSegment, type TTSVoiceOption } from './tts/types';
import { VoxtralSpeechAdapter } from './tts/voxtralAdapter';
import { fetchVoxtralVoices } from './tts/voxtralApi';
import { toMistralLanguageCode } from './tts/languageConfig';

interface PlaybackControllerFacade {
  getSnapshot(): PlaybackSnapshot;
  pause(): void;
  play(request: PlaybackRequest): Promise<void>;
  resume(): void;
  stop(): void;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void;
}

export interface SpeakTextRequest {
  text: string;
  idPrefix: string;
  ownerId: string;
  language: Language;
  settings: TTSSettings;
  onFallback?: () => void;
  onVoxtralVoiceResolved?: (language: Language, voiceId: string) => void;
}

export interface TTSServiceOptions {
  browserVoices(language: Language): Promise<TTSVoiceOption[]>;
  controller: PlaybackControllerFacade;
  createSegments(text: string, language: Language, idPrefix: string): SpeechSegment[];
  subscribeToBrowserVoices?(listener: () => void): () => void;
  voxtralVoices(language: Language, signal?: AbortSignal): Promise<TTSVoiceOption[]>;
}

export const createTTSService = (options: TTSServiceOptions) => {
  const voxtralVoiceCache = new Map<Language, TTSVoiceOption[]>();
  const voxtralVoiceRequests = new Map<Language, Promise<TTSVoiceOption[]>>();
  const compatibleVoxtralVoices = (language: Language, voices: TTSVoiceOption[]): TTSVoiceOption[] => {
    const languageCode = toMistralLanguageCode(language);
    if (!languageCode) return [];
    return voices.filter((voice) => voice.provider === 'voxtral' && voice.languages.some((candidate) => {
      const normalized = candidate.toLowerCase().replace('_', '-');
      return normalized === languageCode || normalized.startsWith(`${languageCode}-`);
    }));
  };
  const waitForSignal = <T,>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return promise;
    if (signal.aborted) {
      return Promise.reject(new TTSAdapterError('cancelled', 'Voxtral voice discovery was cancelled'));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new TTSAdapterError('cancelled', 'Voxtral voice discovery was cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  };
  const getVoxtralVoices = (language: Language, signal?: AbortSignal): Promise<TTSVoiceOption[]> => {
    const cached = voxtralVoiceCache.get(language);
    if (cached) return waitForSignal(Promise.resolve(cached), signal);

    let pending = voxtralVoiceRequests.get(language);
    if (!pending) {
      pending = options.voxtralVoices(language, undefined).then((voices) => {
        const compatible = compatibleVoxtralVoices(language, voices);
        voxtralVoiceCache.set(language, compatible);
        return compatible;
      });
      voxtralVoiceRequests.set(language, pending);
      const clearPending = () => {
        if (voxtralVoiceRequests.get(language) === pending) voxtralVoiceRequests.delete(language);
      };
      void pending.then(clearPending, clearPending);
    }
    return waitForSignal(pending, signal);
  };
  const speakSegments = (request: PlaybackRequest): Promise<void> => options.controller.play(request);
  const speakText = (request: SpeakTextRequest): Promise<void> => speakSegments({
    segments: options.createSegments(request.text, request.language, request.idPrefix),
    ownerId: request.ownerId,
    language: request.language,
    settings: request.settings,
    onFallback: request.onFallback,
    ...(request.onVoxtralVoiceResolved
      ? { onVoxtralVoiceResolved: request.onVoxtralVoiceResolved }
      : {}),
  });
  const getVoicesForLanguage = (
    language: Language,
    provider: TTSProvider,
    signal?: AbortSignal,
  ): Promise<TTSVoiceOption[]> => provider === 'voxtral'
    ? getVoxtralVoices(language, signal)
    : options.browserVoices(language);

  return {
    getPlaybackSnapshot: (): PlaybackSnapshot => options.controller.getSnapshot(),
    getVoicesForLanguage,
    resolveVoxtralVoice: async (language: Language, signal: AbortSignal): Promise<string | null> =>
      (await getVoxtralVoices(language, signal))[0]?.id ?? null,
    pauseSpeech: (): void => options.controller.pause(),
    resumeSpeech: (): void => options.controller.resume(),
    speakSegments,
    speakText,
    stopSpeech: (): void => options.controller.stop(),
    subscribeToPlayback: (
      listener: (snapshot: PlaybackSnapshot) => void,
    ): (() => void) => options.controller.subscribe(listener),
    subscribeToVoiceChanges: (
      listener: () => void,
    ): (() => void) => options.subscribeToBrowserVoices?.(listener) ?? (() => undefined),
  };
};

const cache = new AudioCache();
const browserAdapter = new BrowserSpeechAdapter();
const voxtralAdapter = new VoxtralSpeechAdapter({ cache });
let resolveSingletonVoxtralVoice = async (_language: Language, _signal: AbortSignal): Promise<string | null> => null;
const controller = new PlaybackController({
  adapters: {
    browser: browserAdapter,
    voxtral: voxtralAdapter,
  },
  resolveVoxtralVoice: (language, signal) => resolveSingletonVoxtralVoice(language, signal),
});
const singleton = createTTSService({
  browserVoices: (language) => browserAdapter.getVoices(language),
  controller,
  createSegments: createSpeechSegments,
  subscribeToBrowserVoices: (listener) => browserAdapter.subscribeToVoiceChanges(listener),
  voxtralVoices: fetchVoxtralVoices,
});
resolveSingletonVoxtralVoice = singleton.resolveVoxtralVoice;

export const getPlaybackSnapshot = singleton.getPlaybackSnapshot;
export const getVoicesForLanguage = singleton.getVoicesForLanguage;
export const pauseSpeech = singleton.pauseSpeech;
export const resumeSpeech = singleton.resumeSpeech;
export const speakSegments = singleton.speakSegments;
export const speakText = singleton.speakText;
export const stopSpeech = singleton.stopSpeech;
export const subscribeToPlayback = singleton.subscribeToPlayback;
export const subscribeToVoiceChanges = singleton.subscribeToVoiceChanges;
