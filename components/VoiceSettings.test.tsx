import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TTS_SAMPLE_SENTENCES } from '../constants';
import { createDefaultTTSSettings, getTTSPreference } from '../services/tts/settings';
import type { TTSVoiceOption } from '../services/tts/types';
import type { SpeakTextRequest } from '../services/ttsService';
import { Language, Level, type TTSSettings } from '../types';
import VoiceSettings from './VoiceSettings';

const service = vi.hoisted(() => ({
  getVoicesForLanguage: vi.fn(),
  speakText: vi.fn((_request: SpeakTextRequest) => Promise.resolve()),
  stopSpeech: vi.fn(),
  subscribeToVoiceChanges: vi.fn((_listener: () => void) => () => undefined),
}));

vi.mock('../services/ttsService', () => service);

const voxtralVoice = (
  id: string,
  displayName: string,
  languages: string[],
): TTSVoiceOption => ({ id, name: displayName, displayName, provider: 'voxtral', languages });

const browserVoice = (name: string, language: string): TTSVoiceOption => ({
  id: name,
  name,
  displayName: `${name} (${language})`,
  provider: 'browser',
  languages: [language],
});

interface HarnessProps {
  language?: Language;
  initialValue?: TTSSettings;
  onFallback?: () => void;
  onValue?: (value: TTSSettings) => void;
}

const Harness = ({
  language = Language.Spanish,
  initialValue = createDefaultTTSSettings(language, 0.8),
  onFallback,
  onValue,
}: HarnessProps) => {
  const [value, setValue] = useState(initialValue);

  return (
    <VoiceSettings
      language={language}
      level={Level.A2}
      value={value}
      onFallback={onFallback}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
};

describe('VoiceSettings', () => {
  beforeEach(() => {
    service.getVoicesForLanguage.mockReset();
    service.speakText.mockReset().mockResolvedValue(undefined);
    service.stopSpeech.mockReset();
    service.subscribeToVoiceChanges.mockReset().mockReturnValue(() => undefined);
  });

  it('defaults Spanish to Voxtral, filters incompatible presets, and persists the first compatible voice', async () => {
    const onValue = vi.fn();
    service.getVoicesForLanguage.mockResolvedValue([
      voxtralVoice('french', 'French preset', ['fr']),
      voxtralVoice('spanish', 'Spanish preset', ['es']),
      voxtralVoice('spanish-mx', 'Spanish MX preset', ['es-MX']),
    ]);

    render(<Harness onValue={onValue} />);

    expect((screen.getByRole('radio', { name: 'Voxtral' }) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByRole('option', { name: 'Spanish preset' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Spanish MX preset' })).not.toBeNull();
    expect(screen.queryByRole('option', { name: 'French preset' })).toBeNull();
    expect(screen.getByText(/spoken text is sent to Mistral/i)).not.toBeNull();
    expect(service.getVoicesForLanguage).toHaveBeenCalledWith(
      Language.Spanish,
      'voxtral',
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(getTTSPreference(onValue.mock.calls.at(-1)?.[0], Language.Spanish).voxtralVoiceId)
        .toBe('spanish');
    });
  });

  it('disables Voxtral and selects Browser for Japanese', async () => {
    service.getVoicesForLanguage.mockResolvedValue([browserVoice('Kyoko', 'ja-JP')]);

    render(<Harness language={Language.Japanese} />);

    expect(screen.getByText('Voxtral is not available for this language.')).not.toBeNull();
    expect((screen.getByRole('radio', { name: 'Voxtral' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Browser' }) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByRole('option', { name: 'Kyoko (ja-JP)' })).not.toBeNull();
    expect(service.getVoicesForLanguage).toHaveBeenCalledWith(Language.Japanese, 'browser');
  });

  it.each([
    [Language.Japanese, 'Kyoko'],
    [Language.Chinese, 'Ting-Ting'],
  ])('persists Browser normalization for raw Voxtral settings in %s', async (language, browserVoiceName) => {
    const onValue = vi.fn();
    const initialValue: TTSSettings = {
      speed: 0.8,
      autoRead: false,
      preferences: {
        [language]: {
          provider: 'voxtral',
          voxtralVoiceId: 'unsupported-preset',
          browserVoiceName,
        },
      },
    };
    service.getVoicesForLanguage.mockRejectedValue(new Error('voice discovery unavailable'));

    render(<Harness language={language} initialValue={initialValue} onValue={onValue} />);

    expect((screen.getByRole('radio', { name: 'Browser' }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => {
      const persisted = onValue.mock.calls.at(-1)?.[0] as TTSSettings | undefined;
      expect(persisted?.preferences[language]).toEqual({
        provider: 'browser',
        voxtralVoiceId: 'unsupported-preset',
        browserVoiceName,
      });
    });
  });

  it.each([Language.Japanese, Language.Chinese])(
    'uses selectable System default and permits preview when %s has no enumerated voices',
    async (language) => {
      const user = userEvent.setup();
      service.getVoicesForLanguage.mockResolvedValue([]);

      render(<Harness language={language} />);

      const systemDefault = await screen.findByRole('option', { name: 'System default' });
      expect((systemDefault.parentElement as HTMLSelectElement).value).toBe('');
      const preview = screen.getByRole('button', { name: 'Play sample' }) as HTMLButtonElement;
      expect(preview.disabled).toBe(false);
      await user.click(preview);
      expect(service.speakText).toHaveBeenCalledTimes(1);
      expect(getTTSPreference(service.speakText.mock.calls[0][0].settings, language)).toMatchObject({
        provider: 'browser',
        browserVoiceName: '',
      });
    },
  );

  it('restores the saved voice for each source when switching providers', async () => {
    const user = userEvent.setup();
    const initialValue: TTSSettings = {
      speed: 0.8,
      autoRead: false,
      preferences: {
        [Language.Spanish]: {
          provider: 'voxtral',
          voxtralVoiceId: 'voxtral-two',
          browserVoiceName: 'Monica',
        },
      },
    };
    service.getVoicesForLanguage.mockImplementation((_language, provider) => Promise.resolve(
      provider === 'voxtral'
        ? [voxtralVoice('voxtral-one', 'Voxtral One', ['es']), voxtralVoice('voxtral-two', 'Voxtral Two', ['es'])]
        : [browserVoice('Monica', 'es-ES'), browserVoice('Paulina', 'es-MX')],
    ));

    render(<Harness initialValue={initialValue} />);

    expect((await screen.findByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value).toBe('voxtral-two');
    await user.click(screen.getByRole('radio', { name: 'Browser' }));
    expect((await screen.findByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value).toBe('Monica');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice' }), 'Paulina');
    await user.click(screen.getByRole('radio', { name: 'Voxtral' }));
    expect((await screen.findByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value).toBe('voxtral-two');
    await user.click(screen.getByRole('radio', { name: 'Browser' }));
    expect((await screen.findByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value).toBe('Paulina');
  });

  it('preserves a saved Browser voice through empty discovery and restores it after voiceschanged', async () => {
    let announceVoiceChange: (() => void) | undefined;
    let discoveredVoices: TTSVoiceOption[] = [];
    const onValue = vi.fn();
    const initialValue: TTSSettings = {
      speed: 0.8,
      autoRead: false,
      preferences: {
        [Language.Spanish]: {
          provider: 'browser',
          voxtralVoiceId: 'spanish-preset',
          browserVoiceName: 'Monica',
        },
      },
    };
    service.getVoicesForLanguage.mockImplementation(() => Promise.resolve(discoveredVoices));
    service.subscribeToVoiceChanges.mockImplementation((listener) => {
      announceVoiceChange = listener;
      return () => undefined;
    });

    render(<Harness initialValue={initialValue} onValue={onValue} />);

    expect(await screen.findByRole('option', { name: 'System default' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Monica (not currently available)' })).not.toBeNull();
    expect((screen.getByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value).toBe('Monica');
    expect(onValue).not.toHaveBeenCalled();

    discoveredVoices = [
      browserVoice('Paulina', 'es-MX'),
      browserVoice('Monica', 'es-ES'),
    ];
    act(() => announceVoiceChange?.());

    expect((await screen.findByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value)
      .toBe('Monica');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('keeps Browser available after the Voxtral voice list fails', async () => {
    const user = userEvent.setup();
    service.getVoicesForLanguage.mockImplementation((_language, provider) => (
      provider === 'voxtral'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve([browserVoice('Monica', 'es-ES')])
    ));

    render(<Harness />);

    expect(await screen.findByText('Voxtral voices could not be loaded.')).not.toBeNull();
    expect((screen.getByRole('radio', { name: 'Browser' }) as HTMLInputElement).disabled).toBe(false);
    await user.click(screen.getByRole('radio', { name: 'Browser' }));
    expect(await screen.findByRole('option', { name: 'Monica (es-ES)' })).not.toBeNull();
  });

  it('previews with the current language, provider, selected voice, and speed', async () => {
    const user = userEvent.setup();
    const onFallback = vi.fn();
    service.getVoicesForLanguage.mockResolvedValue([
      voxtralVoice('spanish', 'Spanish preset', ['es']),
    ]);

    const { unmount } = render(<Harness onFallback={onFallback} />);
    await screen.findByRole('option', { name: 'Spanish preset' });
    await user.click(screen.getByRole('button', { name: 'Play sample' }));

    expect(service.speakText).toHaveBeenCalledWith({
      text: TTS_SAMPLE_SENTENCES[Language.Spanish],
      idPrefix: 'voice-preview',
      ownerId: 'voice-preview',
      language: Language.Spanish,
      settings: expect.objectContaining({ speed: 0.8 }),
      onFallback,
    });
    const request = service.speakText.mock.calls[0][0];
    expect(getTTSPreference(request.settings, Language.Spanish)).toMatchObject({
      provider: 'voxtral',
      voxtralVoiceId: 'spanish',
    });

    unmount();
    expect(service.stopSpeech).toHaveBeenCalledTimes(1);
  });

  it('updates speed and auto-read without discarding any language voice preferences', async () => {
    const onValue = vi.fn();
    const initialValue: TTSSettings = {
      speed: 0.8,
      autoRead: false,
      preferences: {
        [Language.Spanish]: {
          provider: 'voxtral',
          voxtralVoiceId: 'spanish',
          browserVoiceName: 'Monica',
        },
        [Language.German]: {
          provider: 'browser',
          voxtralVoiceId: 'german-preset',
          browserVoiceName: 'Katja',
        },
      },
    };
    service.getVoicesForLanguage.mockResolvedValue([
      voxtralVoice('spanish', 'Spanish preset', ['es']),
    ]);

    render(<Harness initialValue={initialValue} onValue={onValue} />);
    await screen.findByRole('option', { name: 'Spanish preset' });
    fireEvent.change(screen.getByRole('slider', { name: /Speed:/ }), { target: { value: '1.2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Always read out loud' }));

    const updated = onValue.mock.calls.at(-1)?.[0] as TTSSettings;
    expect(updated.speed).toBe(1.2);
    expect(updated.autoRead).toBe(true);
    expect(updated.preferences).toEqual(initialValue.preferences);
  });

  it('aborts an obsolete Voxtral request when the language changes', () => {
    const signals: AbortSignal[] = [];
    service.getVoicesForLanguage.mockImplementation((_language, provider, signal) => {
      if (provider === 'voxtral') signals.push(signal);
      return new Promise(() => undefined);
    });

    const { rerender } = render(
      <VoiceSettings
        language={Language.Spanish}
        level={Level.A2}
        value={createDefaultTTSSettings(Language.Spanish)}
        onFallback={() => undefined}
        onChange={() => undefined}
      />,
    );
    rerender(
      <VoiceSettings
        language={Language.French}
        level={Level.A2}
        value={createDefaultTTSSettings(Language.French)}
        onFallback={() => undefined}
        onChange={() => undefined}
      />,
    );

    expect(signals[0].aborted).toBe(true);
  });
});
