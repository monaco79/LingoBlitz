import type { Language, TTSProvider } from '../../types';

export interface SpeechSegment {
  id: string;
  displayText: string;
  spokenText: string;
  visibleSentenceId: string;
}

export interface PlaybackUnit {
  readonly started: Promise<void>;
  play(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  stop(): void;
  dispose(): void;
}

export interface SpeechAdapter {
  prepare(segment: SpeechSegment, context: AdapterContext, signal: AbortSignal): Promise<PlaybackUnit>;
}

export interface AdapterContext {
  language: Language;
  voiceId: string;
  speed: number;
  modelMarker: string;
}

export interface TTSVoiceOption {
  id: string;
  name: string;
  displayName: string;
  provider: TTSProvider;
  languages: string[];
}

export const SYSTEM_DEFAULT_BROWSER_VOICE: Readonly<TTSVoiceOption> = {
  id: '',
  name: '',
  displayName: 'System default',
  provider: 'browser',
  languages: [],
};

export type TTSAdapterErrorCategory =
  | 'cancelled'
  | 'configuration'
  | 'timeout'
  | 'rate_limit'
  | 'moderation'
  | 'upstream'
  | 'invalid_audio';

export class TTSAdapterError extends Error {
  constructor(
    readonly category: TTSAdapterErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = 'TTSAdapterError';
  }
}
