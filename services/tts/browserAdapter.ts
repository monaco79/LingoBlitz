import { LANGUAGE_TO_LOCALE } from '../../constants';
import type { Language } from '../../types';
import {
  TTSAdapterError,
  type AdapterContext,
  type PlaybackUnit,
  type SpeechAdapter,
  type SpeechSegment,
  type TTSVoiceOption,
} from './types';

interface BrowserSpeechSynthesis {
  addEventListener?(type: string, listener: EventListenerOrEventListenerObject): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
  pause(): void;
  removeEventListener?(type: string, listener: EventListenerOrEventListenerObject): void;
  resume(): void;
  speak(utterance: SpeechSynthesisUtterance): void;
}

export interface BrowserSpeechAdapterOptions {
  speechSynthesis?: BrowserSpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
}

const sortVoices = (left: SpeechSynthesisVoice, right: SpeechSynthesisVoice): number => {
  const leftName = left.name.toLowerCase();
  const rightName = right.name.toLowerCase();
  const preferences = [
    [leftName.includes('microsoft'), rightName.includes('microsoft')],
    [leftName.includes('google') || leftName.includes('chrome'), rightName.includes('google') || rightName.includes('chrome')],
    [leftName.includes('natural') || !left.localService, rightName.includes('natural') || !right.localService],
  ];

  for (const [leftPreferred, rightPreferred] of preferences) {
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
  }

  return leftName.localeCompare(rightName);
};

const createCancelledError = (): TTSAdapterError =>
  new TTSAdapterError('cancelled', 'Browser speech was cancelled');

export class BrowserSpeechAdapter implements SpeechAdapter {
  private readonly synthesis: BrowserSpeechSynthesis;
  private readonly createUtterance: (text: string) => SpeechSynthesisUtterance;

  constructor(options: BrowserSpeechAdapterOptions = {}) {
    this.synthesis = options.speechSynthesis ?? window.speechSynthesis;
    this.createUtterance = options.createUtterance ?? ((text) => new SpeechSynthesisUtterance(text));
  }

  async getVoices(language: Language): Promise<TTSVoiceOption[]> {
    const languageCode = LANGUAGE_TO_LOCALE[language].split('-')[0].toLowerCase();

    return this.synthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith(languageCode))
      .sort(sortVoices)
      .map((voice) => ({
        id: voice.name,
        name: voice.name,
        displayName: `${voice.name} (${voice.lang})`,
        provider: 'browser',
        languages: [voice.lang.replace('_', '-')],
      }));
  }

  subscribeToVoiceChanges(listener: () => void): () => void {
    if (!this.synthesis.addEventListener || !this.synthesis.removeEventListener) {
      return () => undefined;
    }

    const handleVoiceChange: EventListener = () => listener();
    this.synthesis.addEventListener('voiceschanged', handleVoiceChange);
    return () => this.synthesis.removeEventListener?.('voiceschanged', handleVoiceChange);
  }

  async prepare(
    segment: SpeechSegment,
    context: AdapterContext,
    signal: AbortSignal,
  ): Promise<PlaybackUnit> {
    if (signal.aborted) {
      throw createCancelledError();
    }

    if (!segment.spokenText) {
      return {
        started: Promise.resolve(),
        play: async () => undefined,
        pause: () => undefined,
        resume: async () => undefined,
        stop: () => undefined,
        dispose: () => undefined,
      };
    }

    const utterance = this.createUtterance(segment.spokenText);
    const selectedVoice = this.synthesis.getVoices().find((voice) => voice.name === context.voiceId) ?? null;
    utterance.voice = selectedVoice;
    utterance.lang = LANGUAGE_TO_LOCALE[context.language] ?? selectedVoice?.lang ?? '';
    utterance.rate = context.speed;
    utterance.pitch = 1;
    utterance.volume = 1;

    let playback: Promise<void> | null = null;
    let resolvePlayback: (() => void) | null = null;
    let rejectPlayback: ((error: Error) => void) | null = null;
    let resolveStarted!: () => void;
    let rejectStarted!: (error: Error) => void;
    let startedSettled = false;
    let stopped = false;
    let disposed = false;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    void started.catch(() => undefined);

    const settleStarted = (error?: Error) => {
      if (startedSettled) return;
      startedSettled = true;
      error ? rejectStarted(error) : resolveStarted();
    };

    const settle = (error?: Error) => {
      if (!resolvePlayback) return;
      const resolve = resolvePlayback;
      const reject = rejectPlayback;
      resolvePlayback = null;
      rejectPlayback = null;
      error ? reject?.(error) : resolve();
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      this.synthesis.cancel();
      settleStarted();
      settle();
    };

    const onAbort = () => stop();
    signal.addEventListener('abort', onAbort, { once: true });

    return {
      started,
      play: () => {
        if (playback) return playback;
        if (stopped || signal.aborted) return Promise.resolve();

        playback = new Promise<void>((resolve, reject) => {
          resolvePlayback = resolve;
          rejectPlayback = reject;
          utterance.onstart = () => settleStarted();
          utterance.onend = () => {
            if (!startedSettled) {
              const error = new TTSAdapterError('upstream', 'Browser speech playback failed');
              settleStarted(error);
              settle(error);
              return;
            }
            settle();
          };
          utterance.onerror = () => {
            const error = new TTSAdapterError('upstream', 'Browser speech playback failed');
            settleStarted(error);
            settle(error);
          };
          try {
            this.synthesis.speak(utterance);
          } catch {
            const error = new TTSAdapterError('upstream', 'Browser speech playback failed');
            settleStarted(error);
            settle(error);
          }
        });
        return playback;
      },
      pause: () => {
        if (!stopped) this.synthesis.pause();
      },
      resume: async () => {
        if (!stopped) this.synthesis.resume();
      },
      stop,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        signal.removeEventListener('abort', onAbort);
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        settleStarted();
        settle();
      },
    };
  }
}
