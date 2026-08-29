import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEVEL_TTS_SPEEDS } from '../constants';
import { getTTSPreference } from '../services/tts/settings';
import type { TTSVoiceOption } from '../services/tts/types';
import type { SpeakTextRequest } from '../services/ttsService';
import { Language, Level, Topic, type UserSettings } from '../types';
import Onboarding from './Onboarding';

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

describe('Onboarding voice settings integration', () => {
  beforeEach(() => {
    service.getVoicesForLanguage.mockReset().mockImplementation((language, provider) => {
      if (language === Language.German && provider === 'voxtral') {
        return Promise.resolve([voice('german-one', 'German One', 'voxtral', ['de'])]);
      }
      if (provider === 'browser') return Promise.resolve([]);
      return Promise.resolve([voice('spanish-one', 'Spanish One', 'voxtral', ['es'])]);
    });
    service.subscribeToVoiceChanges.mockReset().mockReturnValue(() => undefined);
    service.stopSpeech.mockReset();
  });

  it('progresses with a compatible provider voice while retaining prior-language preferences and level speed', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onFallback = vi.fn();
    render(<Onboarding onComplete={onComplete} onFallback={onFallback} />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.selectOptions(screen.getByLabelText('My level in my learning language is...'), Level.B2);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: Topic.Travel }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect((screen.getByRole('radio', { name: 'Voxtral' }) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByRole('option', { name: 'Spanish One' })).not.toBeNull();
    expect((screen.getByRole('slider', { name: /Speed:/ }) as HTMLInputElement).value)
      .toBe(String(LEVEL_TTS_SPEEDS[Level.B2]));
    await user.click(screen.getByRole('button', { name: 'Play sample' }));
    expect(service.speakText.mock.calls[0][0].onFallback).toBe(onFallback);

    service.stopSpeech.mockClear();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(service.stopSpeech).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.selectOptions(screen.getByLabelText('I want to learn...'), Language.German);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('option', { name: 'German One' })).not.toBeNull();
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Start Learning!' }) as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: 'Start Learning!' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const completed = onComplete.mock.calls[0][0] as UserSettings;
    expect(completed.learningLanguage).toBe(Language.German);
    expect(completed.tts.speed).toBe(LEVEL_TTS_SPEEDS[Level.B2]);
    expect(getTTSPreference(completed.tts, Language.Spanish).voxtralVoiceId).toBe('spanish-one');
    expect(getTTSPreference(completed.tts, Language.German)).toMatchObject({
      provider: 'voxtral',
      voxtralVoiceId: 'german-one',
    });
  });

  it.each([Language.Japanese, Language.Chinese])(
    'allows %s onboarding with Browser System default when enumeration stays empty',
    async (language) => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      render(<Onboarding onComplete={onComplete} onFallback={() => undefined} />);

      await user.selectOptions(screen.getByLabelText('I want to learn...'), language);
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: Topic.Travel }));
      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(await screen.findByRole('option', { name: 'System default' })).not.toBeNull();
      const start = screen.getByRole('button', { name: 'Start Learning!' }) as HTMLButtonElement;
      expect(start.disabled).toBe(false);
      await user.click(start);

      const completed = onComplete.mock.calls[0][0] as UserSettings;
      expect(getTTSPreference(completed.tts, language)).toMatchObject({
        provider: 'browser',
        browserVoiceName: '',
      });
    },
  );
});
