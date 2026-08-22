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
import type { SpeechSegment, TTSVoiceOption } from './tts/types';
import { VoxtralSpeechAdapter } from './tts/voxtralAdapter';
import { fetchVoxtralVoices } from './tts/voxtralApi';

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
  language: Language;
  settings: TTSSettings;
  onFallback?: () => void;
}

export interface TTSServiceOptions {
  browserVoices(language: Language): Promise<TTSVoiceOption[]>;
  controller: PlaybackControllerFacade;
  createSegments(text: string, language: Language, idPrefix: string): SpeechSegment[];
  subscribeToBrowserVoices?(listener: () => void): () => void;
  voxtralVoices(language: Language, signal?: AbortSignal): Promise<TTSVoiceOption[]>;
}

export const createTTSService = (options: TTSServiceOptions) => {
  const speakSegments = (request: PlaybackRequest): Promise<void> => options.controller.play(request);
  const speakText = (request: SpeakTextRequest): Promise<void> => speakSegments({
    segments: options.createSegments(request.text, request.language, request.idPrefix),
    language: request.language,
    settings: request.settings,
    onFallback: request.onFallback,
  });
  const getVoicesForLanguage = (
    language: Language,
    provider: TTSProvider,
    signal?: AbortSignal,
  ): Promise<TTSVoiceOption[]> => provider === 'voxtral'
    ? options.voxtralVoices(language, signal)
    : options.browserVoices(language);

  return {
    getPlaybackSnapshot: (): PlaybackSnapshot => options.controller.getSnapshot(),
    getVoicesForLanguage,
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
const controller = new PlaybackController({
  adapters: {
    browser: browserAdapter,
    voxtral: voxtralAdapter,
  },
});
const singleton = createTTSService({
  browserVoices: (language) => browserAdapter.getVoices(language),
  controller,
  createSegments: createSpeechSegments,
  subscribeToBrowserVoices: (listener) => browserAdapter.subscribeToVoiceChanges(listener),
  voxtralVoices: fetchVoxtralVoices,
});

export const getPlaybackSnapshot = singleton.getPlaybackSnapshot;
export const getVoicesForLanguage = singleton.getVoicesForLanguage;
export const pauseSpeech = singleton.pauseSpeech;
export const resumeSpeech = singleton.resumeSpeech;
export const speakSegments = singleton.speakSegments;
export const speakText = singleton.speakText;
export const stopSpeech = singleton.stopSpeech;
export const subscribeToPlayback = singleton.subscribeToPlayback;
export const subscribeToVoiceChanges = singleton.subscribeToVoiceChanges;
