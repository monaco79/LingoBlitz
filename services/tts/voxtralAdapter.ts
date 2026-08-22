import type { Language } from '../../types';
import { AudioCache } from './audioCache';
import { normalizeSpeechText } from './textSegments';
import {
  TTSAdapterError,
  type AdapterContext,
  type PlaybackUnit,
  type SpeechAdapter,
  type SpeechSegment,
} from './types';
import { fetchVoxtralAudio } from './voxtralApi';

type FetchAudio = (
  segment: SpeechSegment,
  language: Language,
  voiceId: string,
  signal?: AbortSignal,
) => Promise<Blob>;

export interface VoxtralSpeechAdapterOptions {
  cache: AudioCache;
  fetchAudio?: FetchAudio;
  createAudio?: () => HTMLAudioElement;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

const silentUnit = (): PlaybackUnit => ({
  play: async () => undefined,
  pause: () => undefined,
  resume: async () => undefined,
  stop: () => undefined,
  dispose: () => undefined,
});

const cancelledError = (): TTSAdapterError =>
  new TTSAdapterError('cancelled', 'Voxtral playback was cancelled');

const invalidAudioError = (): TTSAdapterError =>
  new TTSAdapterError('invalid_audio', 'Voxtral audio playback failed');

export const createVoxtralCacheKey = (segment: SpeechSegment, context: AdapterContext): string => [
  context.language,
  context.modelMarker,
  context.voiceId,
  normalizeSpeechText(segment.spokenText),
].join('\u0000');

export class VoxtralSpeechAdapter implements SpeechAdapter {
  private readonly cache: AudioCache;
  private readonly fetchAudio: FetchAudio;
  private readonly createAudio: () => HTMLAudioElement;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;

  constructor(options: VoxtralSpeechAdapterOptions) {
    this.cache = options.cache;
    this.fetchAudio = options.fetchAudio ?? fetchVoxtralAudio;
    this.createAudio = options.createAudio ?? (() => new Audio());
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectURL = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  }

  async prepare(
    segment: SpeechSegment,
    context: AdapterContext,
    signal: AbortSignal,
  ): Promise<PlaybackUnit> {
    const normalizedText = normalizeSpeechText(segment.spokenText);
    if (!normalizedText) {
      return silentUnit();
    }
    if (signal.aborted) {
      throw cancelledError();
    }

    const normalizedSegment = normalizedText === segment.spokenText
      ? segment
      : { ...segment, spokenText: normalizedText };
    const cacheKey = createVoxtralCacheKey(normalizedSegment, context);
    let sourceUrl = this.cache.get(cacheKey);
    let cacheOwned = sourceUrl !== undefined;

    if (!sourceUrl) {
      let blob: Blob;
      try {
        blob = await this.fetchAudio(normalizedSegment, context.language, context.voiceId, signal);
      } catch (error) {
        if (error instanceof TTSAdapterError) throw error;
        if (signal.aborted) throw cancelledError();
        throw new TTSAdapterError('upstream', 'Voxtral audio request failed');
      }
      if (signal.aborted) {
        throw cancelledError();
      }

      sourceUrl = this.cache.set(cacheKey, blob);
      cacheOwned = sourceUrl !== undefined;
      sourceUrl ??= this.createObjectURL(blob);
    }

    const audio = this.createAudio();
    audio.src = sourceUrl;
    audio.playbackRate = context.speed;

    let playback: Promise<void> | null = null;
    let resolvePlayback: (() => void) | null = null;
    let rejectPlayback: ((error: Error) => void) | null = null;
    let stopped = false;
    let disposed = false;

    const settle = (error?: Error) => {
      if (!resolvePlayback) return;
      const resolve = resolvePlayback;
      const reject = rejectPlayback;
      resolvePlayback = null;
      rejectPlayback = null;
      error ? reject?.(error) : resolve();
    };
    const onEnded = () => settle();
    const onError = () => settle(invalidAudioError());
    const halt = () => {
      audio.pause();
      audio.currentTime = 0;
    };
    const onAbort = () => {
      if (stopped) return;
      stopped = true;
      halt();
      settle(cancelledError());
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });

    return {
      play: () => {
        if (playback) return playback;
        if (signal.aborted) return Promise.reject(cancelledError());
        if (stopped) return Promise.resolve();

        playback = new Promise<void>((resolve, reject) => {
          resolvePlayback = resolve;
          rejectPlayback = reject;
          try {
            void Promise.resolve(audio.play()).catch(() => settle(invalidAudioError()));
          } catch {
            settle(invalidAudioError());
          }
        });
        return playback;
      },
      pause: () => {
        if (!stopped) audio.pause();
      },
      resume: async () => {
        if (stopped) return;
        try {
          await audio.play();
        } catch {
          const error = invalidAudioError();
          settle(error);
          throw error;
        }
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        halt();
        settle();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
        settle();
        if (!cacheOwned) this.revokeObjectURL(sourceUrl);
      },
    };
  }
}
