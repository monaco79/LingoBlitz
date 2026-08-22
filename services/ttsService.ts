import { LANGUAGE_TO_LOCALE } from '../constants';
import {
  type AzureVoice,
  type Language,
  type TTSProvider,
  type TTSSettings,
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

interface LegacySpeechSynthesis {
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
  readonly paused?: boolean;
  pause(): void;
  resume(): void;
  speak(utterance: SpeechSynthesisUtterance): void;
  readonly speaking?: boolean;
  onvoiceschanged?: (() => void) | null;
}

export interface LegacyBrowserSpeechOptions {
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  speechSynthesis?: LegacySpeechSynthesis;
}

export const createLegacyBrowserSpeech = (options: LegacyBrowserSpeechOptions = {}) => {
  const synthesis = options.speechSynthesis ?? window.speechSynthesis;
  const createUtterance = options.createUtterance
    ?? ((text: string) => new SpeechSynthesisUtterance(text));
  let currentUtterance: SpeechSynthesisUtterance | null = null;
  let isCurrentlyPlaying = false;
  let isPaused = false;
  let manuallyCancelled = false;
  let playbackEndCallback: (() => void) | null = null;

  const getAllVoices = (): Promise<SpeechSynthesisVoice[]> => new Promise((resolve) => {
    const loadedVoices = synthesis?.getVoices() ?? [];
    if (loadedVoices.length > 0 || !synthesis) {
      resolve(loadedVoices);
      return;
    }

    let resolved = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (resolved) return;
      resolved = true;
      resolve(voices);
    };
    synthesis.onvoiceschanged = () => finish(synthesis.getVoices());

    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      const voices = synthesis.getVoices();
      if (voices.length > 0) {
        window.clearInterval(intervalId);
        finish(voices);
      } else if (attempts > 25) {
        window.clearInterval(intervalId);
      }
    }, 200);

    window.setTimeout(() => {
      window.clearInterval(intervalId);
      finish(synthesis.getVoices());
    }, 5_000);
  });

  const stop = (): void => {
    manuallyCancelled = true;
    if (currentUtterance) synthesis?.cancel();
    isCurrentlyPlaying = false;
    isPaused = false;
    playbackEndCallback = null;
    currentUtterance = null;
  };

  const pause = (): void => {
    if (currentUtterance && synthesis?.speaking && !synthesis.paused) {
      synthesis.pause();
      isPaused = true;
      isCurrentlyPlaying = false;
    }
  };

  const resume = (): void => {
    if (currentUtterance && synthesis?.paused) {
      synthesis.resume();
      isPaused = false;
      isCurrentlyPlaying = true;
    }
  };

  const speak = async (
    text: string,
    voiceName: string,
    speed: number,
    language?: Language,
    onPlaybackEnd?: () => void,
    onBoundary?: (charIndex: number) => void,
  ): Promise<void> => {
    if (!isPaused) stop();
    if (!synthesis) throw new Error('Speech Synthesis not supported in this browser');

    isCurrentlyPlaying = true;
    isPaused = false;
    manuallyCancelled = false;
    playbackEndCallback = onPlaybackEnd ?? null;

    const voices = await getAllVoices();
    const selectedVoice = voices.find((voice) => voice.name === voiceName) ?? null;
    const utterance = createUtterance(text);
    currentUtterance = utterance;
    utterance.voice = selectedVoice;
    if (language) {
      utterance.lang = LANGUAGE_TO_LOCALE[language];
    } else if (selectedVoice) {
      utterance.lang = selectedVoice.lang;
    }
    utterance.rate = speed;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (onBoundary) {
      utterance.onboundary = (event) => onBoundary(event.charIndex);
    }

    return new Promise<void>((resolve, reject) => {
      utterance.onend = () => {
        isCurrentlyPlaying = false;
        isPaused = false;
        playbackEndCallback?.();
        playbackEndCallback = null;
        currentUtterance = null;
        resolve();
      };
      utterance.onerror = (event) => {
        if (manuallyCancelled) return;
        isCurrentlyPlaying = false;
        isPaused = false;
        currentUtterance = null;
        reject(new Error(`Speech error: ${event.error}`));
      };
      synthesis.speak(utterance);
    });
  };

  return {
    getDefaultVoice: async (language: Language): Promise<string> => {
      const languageCode = LANGUAGE_TO_LOCALE[language].split('-')[0].toLowerCase();
      const voices = (await getAllVoices()).filter((voice) =>
        voice.lang.toLowerCase().startsWith(languageCode));
      return voices[0]?.name ?? '';
    },
    isSpeaking: (): boolean => isCurrentlyPlaying && Boolean(synthesis?.speaking),
    pause,
    resume,
    speak,
    stop,
  };
};

type LegacyBrowserSpeech = ReturnType<typeof createLegacyBrowserSpeech>;

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
  legacy: LegacyBrowserSpeech;
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

  function getVoicesForLanguage(
    language: Language,
  ): Promise<Array<TTSVoiceOption & AzureVoice>>;
  function getVoicesForLanguage(
    language: Language,
    provider: TTSProvider,
    signal?: AbortSignal,
  ): Promise<TTSVoiceOption[]>;
  async function getVoicesForLanguage(
    language: Language,
    provider?: TTSProvider,
    signal?: AbortSignal,
  ): Promise<TTSVoiceOption[]> {
    if (provider === 'voxtral') {
      return options.voxtralVoices(language, signal);
    }
    const voices = await options.browserVoices(language);
    if (provider === 'browser') return voices;
    return voices.map((voice) => ({
      ...voice,
      locale: voice.languages[0] ?? LANGUAGE_TO_LOCALE[language],
    }));
  }

  return {
    getDefaultVoice: async (
      language: Language,
      provider: TTSProvider = 'browser',
    ): Promise<string> => (await getVoicesForLanguage(language, provider))[0]?.id ?? '',
    getPlaybackSnapshot: (): PlaybackSnapshot => options.controller.getSnapshot(),
    getVoicesForLanguage,
    isSpeaking: (): boolean =>
      options.controller.getSnapshot().status === 'playing' || options.legacy.isSpeaking(),
    pauseSpeech: (): void => {
      options.controller.pause();
      options.legacy.pause();
    },
    resumeSpeech: (): void => {
      options.controller.resume();
      options.legacy.resume();
    },
    /** @deprecated Use speakText with an object request. Removed after Task 8 migration. */
    speak: options.legacy.speak,
    speakSegments,
    speakText,
    stopSpeech: (): void => {
      options.controller.stop();
      options.legacy.stop();
    },
    subscribeToPlayback: (
      listener: (snapshot: PlaybackSnapshot) => void,
    ): (() => void) => options.controller.subscribe(listener),
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
const legacy = createLegacyBrowserSpeech();
const singleton = createTTSService({
  browserVoices: (language) => browserAdapter.getVoices(language),
  controller,
  createSegments: createSpeechSegments,
  legacy,
  voxtralVoices: fetchVoxtralVoices,
});

export const getDefaultVoice = singleton.getDefaultVoice;
export const getPlaybackSnapshot = singleton.getPlaybackSnapshot;
export const getVoicesForLanguage = singleton.getVoicesForLanguage;
export const isSpeaking = singleton.isSpeaking;
export const pauseSpeech = singleton.pauseSpeech;
export const resumeSpeech = singleton.resumeSpeech;
/** @deprecated Use speakText with an object request. Removed after Task 8 migration. */
export const speak = singleton.speak;
export const speakSegments = singleton.speakSegments;
export const speakText = singleton.speakText;
export const stopSpeech = singleton.stopSpeech;
export const subscribeToPlayback = singleton.subscribeToPlayback;
