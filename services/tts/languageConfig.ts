import type { Language } from '../../types';

const MISTRAL_LANGUAGE_CODES: Partial<Record<Language, string>> = {
  English: 'en',
  French: 'fr',
  German: 'de',
  Spanish: 'es',
  Dutch: 'nl',
  Portuguese: 'pt',
  Italian: 'it',
};

export const isVoxtralSupported = (language: Language): boolean =>
  language in MISTRAL_LANGUAGE_CODES;

export const toMistralLanguageCode = (language: Language): string | null =>
  MISTRAL_LANGUAGE_CODES[language] ?? null;
