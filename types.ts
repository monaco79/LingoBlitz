// Last updated: 2025-11-16 20:30
// Added TTS settings types

export enum Language {
  English = 'English',
  Spanish = 'Spanish',
  French = 'French',
  German = 'German',
  Italian = 'Italian',
  Portuguese = 'Portuguese',
  Japanese = 'Japanese',
  Chinese = 'Chinese (Mandarin)',
  Dutch = 'Dutch',
}

export enum Level {
  AbsoluteBeginner = 'Absolute Beginner',
  A1 = 'A1 (Beginner)',
  A2 = 'A2 (Elementary)',
  B1 = 'B1 (Intermediate)',
  B2 = 'B2 (Upper Intermediate)',
  C1 = 'C1 (Advanced)',
}

export enum Topic {
  Travel = 'Travel',
  Science = 'Science',
  Food = 'Food',
  Sports = 'Sports / Fitness',
  History = 'History',
  Nature = 'Nature',
  Music = 'Music',
  Culture = 'Culture',
  TrueCrime = 'True Crime',
  Fashion = 'Fashion',
  Psychology = 'Psychology',
  Economics = 'Economics',
}

export type TTSProvider = 'voxtral' | 'browser';

export interface LanguageTTSPreference {
  provider: TTSProvider;
  voxtralVoiceId: string;
  browserVoiceName: string;
}

export interface TTSSettings {
  preferences: Partial<Record<Language, LanguageTTSPreference>>;
  speed: number;
  autoRead: boolean;
}

export interface UserSettings {
  nativeLanguage: Language;
  learningLanguage: Language;
  level: Level;
  interests: Topic[];
  blitzedTopics: string[];
  tts: TTSSettings;
}

export enum AppState {
  ONBOARDING,
  GENERATING_PROPOSALS,
  READY,
  GENERATING_ARTICLE,
  POST_ARTICLE_CHOICE,
  SHOWING_QUIZ,
  EVALUATING_QUIZ,
  SHOWING_QUIZ_FEEDBACK,
  PRACTICING_VOCABULARY,
}

export interface TranslationPopup {
  word: string;
  translation: string;
  speechIdPrefix: string;
  position: {
    top: number;
    left: number;
  };
}

export interface VocabularyItem {
  word: string;
  translation: string;
}
