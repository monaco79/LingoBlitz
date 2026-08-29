import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEVEL_TTS_SPEEDS } from '../constants';
import { getTTSPreference } from '../services/tts/settings';
import type { TTSVoiceOption } from '../services/tts/types';
import type { SpeakTextRequest } from '../services/ttsService';
import { Language, Level, Topic, type UserSettings } from '../types';
import SettingsModal from './SettingsModal';

const service = vi.hoisted(() => ({
  getVoicesForLanguage: vi.fn(),
  speakText: vi.fn<(request: SpeakTextRequest) => Promise<void>>(async () => undefined),
  stopSpeech: vi.fn(),
  subscribeToVoiceChanges: vi.fn(() => () => undefined),
}));

vi.mock('../services/ttsService', () => service);

const voice = (
  id: string,
  name: string,
  provider: 'voxtral' | 'browser',
  languages: string[],
): TTSVoiceOption => ({ id, name, displayName: name, provider, languages });

const currentSettings: UserSettings = {
  nativeLanguage: Language.English,
  learningLanguage: Language.Spanish,
  level: Level.A2,
  interests: [Topic.Travel],
  blitzedTopics: [],
  tts: {
    speed: 0.8,
    autoRead: false,
    preferences: {
      [Language.Spanish]: {
        provider: 'voxtral',
        voxtralVoiceId: 'spanish-one',
        browserVoiceName: 'Monica',
      },
      [Language.German]: {
        provider: 'browser',
        voxtralVoiceId: 'german-one',
        browserVoiceName: 'Katja',
      },
    },
  },
};

const SettingsModalHost: React.FC<{ onFallback: () => void }> = ({ onFallback }) => {
  const [isOpen, setIsOpen] = useState(true);
  return isOpen ? (
    <SettingsModal
      currentSettings={currentSettings}
      onSave={() => undefined}
      onClose={() => setIsOpen(false)}
      onFallback={onFallback}
    />
  ) : null;
};

describe('SettingsModal voice settings integration', () => {
  beforeEach(() => {
    service.getVoicesForLanguage.mockReset().mockImplementation((language, provider) => {
      if (language === Language.German && provider === 'browser') {
        return Promise.resolve([voice('Katja', 'Katja', 'browser', ['de-DE'])]);
      }
      if (provider === 'browser') {
        return Promise.resolve([voice('Monica', 'Monica', 'browser', ['es-ES'])]);
      }
      return Promise.resolve([voice('spanish-one', 'Spanish One', 'voxtral', ['es'])]);
    });
    service.subscribeToVoiceChanges.mockReset().mockReturnValue(() => undefined);
    service.stopSpeech.mockReset();
  });

  it('saves provider settings, preserves other languages, and maps level changes to shared speed defaults', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onFallback = vi.fn();
    render(<SettingsModal currentSettings={currentSettings} onSave={onSave} onClose={() => undefined} onFallback={onFallback} />);

    expect((screen.getByRole('radio', { name: 'Voxtral' }) as HTMLInputElement).checked).toBe(true);
    await screen.findByRole('option', { name: 'Spanish One' });
    await user.click(screen.getByRole('button', { name: 'Play sample' }));
    expect(service.speakText.mock.calls[0][0].onFallback).toBe(onFallback);

    await user.click(screen.getByRole('radio', { name: 'Browser' }));
    await screen.findByRole('option', { name: 'Monica' });
    await user.selectOptions(screen.getByLabelText('My level is...'), Level.B2);
    await waitFor(() => {
      expect((screen.getByRole('slider', { name: /Speed:/ }) as HTMLInputElement).value)
        .toBe(String(LEVEL_TTS_SPEEDS[Level.B2]));
    });

    await user.selectOptions(screen.getByLabelText('I want to learn...'), Language.German);
    expect(await screen.findByRole('option', { name: 'Katja' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as UserSettings;
    expect(saved.learningLanguage).toBe(Language.German);
    expect(saved.tts.speed).toBe(LEVEL_TTS_SPEEDS[Level.B2]);
    expect(getTTSPreference(saved.tts, Language.Spanish)).toEqual({
      provider: 'browser',
      voxtralVoiceId: 'spanish-one',
      browserVoiceName: 'Monica',
    });
    expect(getTTSPreference(saved.tts, Language.German)).toEqual(currentSettings.tts.preferences[Language.German]);
  });

  it('stops a voice preview when settings close', async () => {
    const user = userEvent.setup();
    render(<SettingsModalHost onFallback={() => undefined} />);

    await screen.findByRole('option', { name: 'Spanish One' });
    await user.click(screen.getByRole('button', { name: 'Play sample' }));
    service.stopSpeech.mockClear();
    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(service.stopSpeech).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  });

  it('allows saving Japanese with Browser System default when enumeration stays empty', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    service.getVoicesForLanguage.mockImplementation((_language, provider) => (
      provider === 'browser'
        ? Promise.resolve([])
        : Promise.resolve([voice('spanish-one', 'Spanish One', 'voxtral', ['es'])])
    ));
    render(
      <SettingsModal
        currentSettings={currentSettings}
        onSave={onSave}
        onClose={() => undefined}
        onFallback={() => undefined}
      />,
    );

    await screen.findByRole('option', { name: 'Spanish One' });
    await user.selectOptions(screen.getByLabelText('I want to learn...'), Language.Japanese);
    expect(await screen.findByRole('option', { name: 'System default' })).not.toBeNull();
    const save = screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(save);

    const saved = onSave.mock.calls[0][0] as UserSettings;
    expect(getTTSPreference(saved.tts, Language.Japanese)).toMatchObject({
      provider: 'browser',
      browserVoiceName: '',
    });
  });
});
