import { describe, expect, it } from 'vitest';
import { Language } from '../../types';
import { isVoxtralSupported, toMistralLanguageCode } from './languageConfig';
import {
  createDefaultTTSSettings,
  getTTSPreference,
  migrateTTSSettings,
} from './settings';

describe('TTS language configuration', () => {
  it('identifies Voxtral languages and maps their Mistral code', () => {
    expect(isVoxtralSupported(Language.German)).toBe(true);
    expect(isVoxtralSupported(Language.Japanese)).toBe(false);
    expect(toMistralLanguageCode(Language.Portuguese)).toBe('pt');
  });
});

describe('TTS settings migration', () => {
  it('clamps requested default and persisted playback speeds to the supported range', () => {
    expect(createDefaultTTSSettings(Language.German, 0.2).speed).toBe(0.6);
    expect(createDefaultTTSSettings(Language.German, 2).speed).toBe(1.4);
    expect(migrateTTSSettings({ speed: -1 }, Language.German).speed).toBe(0.6);
    expect(migrateTTSSettings({ speed: 1.8 }, Language.German).speed).toBe(1.4);
  });

  it('migrates a legacy browser voice while keeping the browser provider as default', () => {
    const migrated = migrateTTSSettings(
      { voice: 'Google Deutsch', speed: 0.8, autoRead: true },
      Language.German,
    );

    expect(getTTSPreference(migrated, Language.German)).toEqual({
      provider: 'browser',
      voxtralVoiceId: '',
      browserVoiceName: 'Google Deutsch',
    });
    expect(migrated.speed).toBe(0.8);
    expect(migrated.autoRead).toBe(true);
  });

  it('defaults Voxtral-supported languages to the browser provider', () => {
    expect(
      getTTSPreference(createDefaultTTSSettings(Language.German), Language.German).provider,
    ).toBe('browser');
  });

  it('defaults unsupported languages to the browser provider', () => {
    expect(
      getTTSPreference(createDefaultTTSSettings(Language.Chinese), Language.Chinese).provider,
    ).toBe('browser');
  });

  it('normalizes a persisted Voxtral provider to browser for unsupported languages', () => {
    const migrated = migrateTTSSettings(
      {
        speed: 1,
        autoRead: false,
        preferences: {
          [Language.Japanese]: {
            provider: 'voxtral',
            voxtralVoiceId: 'preset-voice',
            browserVoiceName: 'Kyoko',
          },
        },
      },
      Language.Japanese,
    );

    expect(getTTSPreference(migrated, Language.Japanese)).toEqual({
      provider: 'browser',
      voxtralVoiceId: 'preset-voice',
      browserVoiceName: 'Kyoko',
    });
  });

  it('normalizes valid saved preferences without dropping other language settings', () => {
    const migrated = migrateTTSSettings(
      {
        speed: 1.2,
        autoRead: false,
        preferences: {
          [Language.German]: {
            provider: 'voxtral',
            voxtralVoiceId: 'male-1',
            browserVoiceName: 'Google Deutsch',
          },
          [Language.Japanese]: {
            provider: 'browser',
            voxtralVoiceId: '',
            browserVoiceName: 'Kyoko',
          },
        },
      },
      Language.German,
    );

    expect(migrated.preferences).toEqual({
      [Language.German]: {
        provider: 'voxtral',
        voxtralVoiceId: 'male-1',
        browserVoiceName: 'Google Deutsch',
      },
      [Language.Japanese]: {
        provider: 'browser',
        voxtralVoiceId: '',
        browserVoiceName: 'Kyoko',
      },
    });
  });

  it('falls back safely from malformed speed and provider values', () => {
    const migrated = migrateTTSSettings(
      {
        speed: 'fast',
        autoRead: 'yes',
        preferences: {
          [Language.German]: {
            provider: 'invalid-provider',
            voxtralVoiceId: 3,
            browserVoiceName: null,
          },
        },
      },
      Language.German,
    );

    expect(migrated.speed).toBe(1);
    expect(migrated.autoRead).toBe(false);
    expect(getTTSPreference(migrated, Language.German)).toEqual({
      provider: 'browser',
      voxtralVoiceId: '',
      browserVoiceName: '',
    });
  });
});
