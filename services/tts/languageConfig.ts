import { Language } from '../../types';

const MISTRAL_LANGUAGE_CODES: Partial<Record<Language, string>> = {
  [Language.English]: 'en',
  [Language.French]: 'fr',
  [Language.German]: 'de',
  [Language.Spanish]: 'es',
  [Language.Dutch]: 'nl',
  [Language.Portuguese]: 'pt',
  [Language.Italian]: 'it',
};

export const isVoxtralSupported = (language: Language): boolean =>
  language in MISTRAL_LANGUAGE_CODES;

export const toMistralLanguageCode = (language: Language): string | null =>
  MISTRAL_LANGUAGE_CODES[language] ?? null;
