import {
  Language,
  LanguageTTSPreference,
  TTSProvider,
  TTSSettings,
} from '../../types';
import { isVoxtralSupported } from './languageConfig';

const DEFAULT_SPEED = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const defaultPreference = (language: Language): LanguageTTSPreference => ({
  provider: isVoxtralSupported(language) ? 'voxtral' : 'browser',
  voxtralVoiceId: '',
  browserVoiceName: '',
});

const isLanguage = (value: string): value is Language =>
  Object.values(Language).includes(value as Language);

const readPreference = (value: unknown, language: Language): LanguageTTSPreference => {
  const fallback = defaultPreference(language);
  if (!isRecord(value)) return fallback;

  const provider: TTSProvider =
    value.provider === 'voxtral' || value.provider === 'browser'
      ? value.provider
      : fallback.provider;

  return {
    provider,
    voxtralVoiceId: typeof value.voxtralVoiceId === 'string' ? value.voxtralVoiceId : '',
    browserVoiceName: typeof value.browserVoiceName === 'string' ? value.browserVoiceName : '',
  };
};

export const createDefaultTTSSettings = (language: Language, speed = DEFAULT_SPEED): TTSSettings => ({
  voice: '',
  preferences: {
    [language]: defaultPreference(language),
  },
  speed: typeof speed === 'number' && Number.isFinite(speed) ? speed : DEFAULT_SPEED,
  autoRead: false,
});

export const getTTSPreference = (
  settings: TTSSettings,
  language: Language,
): LanguageTTSPreference => readPreference(settings.preferences?.[language], language);

export const migrateTTSSettings = (
  raw: unknown,
  learningLanguage: Language,
): TTSSettings => {
  if (!isRecord(raw)) return createDefaultTTSSettings(learningLanguage);

  const voice = typeof raw.voice === 'string' ? raw.voice : '';
  const preferences: Partial<Record<Language, LanguageTTSPreference>> = {};

  if (isRecord(raw.preferences)) {
    for (const [language, preference] of Object.entries(raw.preferences)) {
      if (isLanguage(language)) {
        preferences[language] = readPreference(preference, language);
      }
    }
  }

  if (!preferences[learningLanguage]) {
    preferences[learningLanguage] = {
      ...defaultPreference(learningLanguage),
      browserVoiceName: voice,
    };
  }

  return {
    voice,
    preferences,
    speed:
      typeof raw.speed === 'number' && Number.isFinite(raw.speed)
        ? raw.speed
        : DEFAULT_SPEED,
    autoRead: typeof raw.autoRead === 'boolean' ? raw.autoRead : false,
  };
};
