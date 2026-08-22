import React, { useEffect, useRef, useState } from 'react';

import { TTS_SAMPLE_SENTENCES } from '../constants';
import { isVoxtralSupported, toMistralLanguageCode } from '../services/tts/languageConfig';
import { getTTSPreference } from '../services/tts/settings';
import type { TTSVoiceOption } from '../services/tts/types';
import * as ttsService from '../services/ttsService';
import type {
  Language,
  LanguageTTSPreference,
  Level,
  TTSProvider,
  TTSSettings,
} from '../types';
import LoadingSpinner from './icons/LoadingSpinner';

export interface VoiceSettingsProps {
  language: Language;
  level: Level;
  value: TTSSettings;
  onChange: (value: TTSSettings) => void;
}

const isCompatibleVoxtralVoice = (voice: TTSVoiceOption, language: Language): boolean => {
  const languageCode = toMistralLanguageCode(language);
  return Boolean(languageCode) && voice.provider === 'voxtral' && voice.languages.some((candidate) => {
    const normalized = candidate.toLowerCase().replace('_', '-');
    return normalized === languageCode || normalized.startsWith(`${languageCode}-`);
  });
};

const VoiceSettings: React.FC<VoiceSettingsProps> = ({ language, level, value, onChange }) => {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [voices, setVoices] = useState<TTSVoiceOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const [browserVoiceRevision, setBrowserVoiceRevision] = useState(0);

  valueRef.current = value;
  onChangeRef.current = onChange;

  const preference = getTTSPreference(value, language);
  const rawProvider = value.preferences?.[language]?.provider;
  const voxtralSupported = isVoxtralSupported(language);
  const activeProvider: TTSProvider = voxtralSupported ? preference.provider : 'browser';
  const selectedVoice = activeProvider === 'voxtral'
    ? preference.voxtralVoiceId
    : preference.browserVoiceName;

  const commit = (next: TTSSettings) => {
    valueRef.current = next;
    onChangeRef.current(next);
  };

  const updatePreference = (patch: Partial<LanguageTTSPreference>) => {
    const current = valueRef.current;
    const currentPreference = getTTSPreference(current, language);
    commit({
      ...current,
      preferences: {
        ...current.preferences,
        [language]: {
          ...currentPreference,
          ...patch,
        },
      },
    });
  };

  useEffect(() => {
    if (!voxtralSupported && rawProvider !== 'browser') {
      updatePreference({ provider: 'browser' });
    }
  }, [language, rawProvider, voxtralSupported]);

  useEffect(() => {
    if (activeProvider !== 'browser') return;
    return ttsService.subscribeToVoiceChanges(() => {
      setBrowserVoiceRevision((revision) => revision + 1);
    });
  }, [activeProvider, language]);

  useEffect(() => {
    let active = true;
    const controller = activeProvider === 'voxtral' ? new AbortController() : null;

    setVoices([]);
    setLoadError(false);
    setIsLoading(true);

    const request = activeProvider === 'voxtral'
      ? ttsService.getVoicesForLanguage(language, 'voxtral', controller?.signal)
      : ttsService.getVoicesForLanguage(language, 'browser');

    void request.then((loadedVoices) => {
      if (!active) return;
      const compatibleVoices = activeProvider === 'voxtral'
        ? loadedVoices.filter((voice) => isCompatibleVoxtralVoice(voice, language))
        : loadedVoices.filter((voice) => voice.provider === 'browser');
      setVoices(compatibleVoices);

      const current = valueRef.current;
      const currentPreference = getTTSPreference(current, language);
      const currentVoice = activeProvider === 'voxtral'
        ? currentPreference.voxtralVoiceId
        : currentPreference.browserVoiceName;
      const selectedExists = compatibleVoices.some((voice) => voice.id === currentVoice);
      const nextVoice = selectedExists
        ? currentVoice
        : compatibleVoices[0]?.id ?? (activeProvider === 'browser' ? currentVoice : '');

      if (nextVoice !== currentVoice) {
        updatePreference(activeProvider === 'voxtral'
          ? { voxtralVoiceId: nextVoice }
          : { browserVoiceName: nextVoice });
      }
    }).catch(() => {
      if (active && !controller?.signal.aborted) setLoadError(true);
    }).finally(() => {
      if (active) setIsLoading(false);
    });

    return () => {
      active = false;
      controller?.abort();
    };
  }, [activeProvider, browserVoiceRevision, language]);

  const changeProvider = (provider: TTSProvider) => {
    if (provider === 'voxtral' && !voxtralSupported) return;
    updatePreference({ provider });
  };

  const changeVoice = (voiceId: string) => {
    updatePreference(activeProvider === 'voxtral'
      ? { voxtralVoiceId: voiceId }
      : { browserVoiceName: voiceId });
  };

  const playSample = async () => {
    if (!selectedVoice) return;
    setIsPlayingSample(true);
    try {
      await ttsService.speakText({
        text: TTS_SAMPLE_SENTENCES[language],
        idPrefix: 'voice-preview',
        language,
        settings: valueRef.current,
      });
    } catch (error) {
      console.error('Failed to play sample:', error);
    } finally {
      setIsPlayingSample(false);
    }
  };

  return (
    <section className="space-y-6" aria-label={`Voice settings for ${language}, ${level}`}>
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Speech source</legend>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Speech source">
          <label className="flex items-center gap-2 p-3 rounded-lingoblitz border-2 border-gray-200 dark:border-gray-600 cursor-pointer">
            <input
              type="radio"
              name="tts-provider"
              value="voxtral"
              checked={activeProvider === 'voxtral'}
              disabled={!voxtralSupported}
              onChange={() => changeProvider('voxtral')}
            />
            <span>Voxtral</span>
          </label>
          <label className="flex items-center gap-2 p-3 rounded-lingoblitz border-2 border-gray-200 dark:border-gray-600 cursor-pointer">
            <input
              type="radio"
              name="tts-provider"
              value="browser"
              checked={activeProvider === 'browser'}
              onChange={() => changeProvider('browser')}
            />
            <span>Browser</span>
          </label>
        </div>
        {!voxtralSupported ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Voxtral is not available for this language.</p>
        ) : (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            When using Voxtral, spoken text is sent to Mistral to generate audio.
          </p>
        )}
      </fieldset>

      <div>
        <label htmlFor="tts-voice" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Voice</label>
        {isLoading ? (
          <div className="flex justify-center items-center py-6" role="status" aria-label="Loading voices">
            <LoadingSpinner className="h-8 w-8 text-sky-500" />
          </div>
        ) : loadError ? (
          <p className="p-3 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-lg text-sm">
            {activeProvider === 'voxtral'
              ? 'Voxtral voices could not be loaded.'
              : 'Browser voices could not be loaded.'}
          </p>
        ) : voices.length === 0 ? (
          <p className="p-3 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-lg text-sm">
            No voices found for this language.
          </p>
        ) : (
          <div className="flex gap-2">
            <select
              id="tts-voice"
              aria-label="Voice"
              value={selectedVoice}
              onChange={(event) => changeVoice(event.target.value)}
              className="flex-1 min-w-0 max-w-full bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lingoblitz py-3 px-4 focus:outline-none focus:ring-2 focus:ring-purple-400 text-gray-900 dark:text-white truncate"
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.displayName}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={playSample}
              disabled={isPlayingSample || !selectedVoice}
              aria-label="Play sample"
              title="Play sample"
              className="bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 border-2 border-[#6263C4] text-gray-800 dark:text-white p-3 rounded-lingoblitz transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlayingSample ? (
                <LoadingSpinner className="h-6 w-6" />
              ) : (
                <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="tts-speed" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Speed: {value.speed.toFixed(1)}x
        </label>
        <input
          id="tts-speed"
          aria-label={`Speed: ${value.speed.toFixed(1)}x`}
          type="range"
          min="0.6"
          max="1.4"
          step="0.1"
          value={value.speed}
          onChange={(event) => commit({ ...valueRef.current, speed: Number(event.target.value) })}
          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
        />
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
          <span>Slower</span>
          <span>Faster</span>
        </div>
      </div>

      <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lingoblitz">
        <input
          type="checkbox"
          id="tts-auto-read"
          checked={value.autoRead}
          onChange={(event) => commit({ ...valueRef.current, autoRead: event.target.checked })}
          className="w-5 h-5 text-purple-600 bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 rounded focus:ring-purple-500 focus:ring-2 cursor-pointer"
        />
        <label htmlFor="tts-auto-read" className="text-gray-700 dark:text-gray-300 font-medium cursor-pointer">
          Always read out loud
        </label>
      </div>
    </section>
  );
};

export default VoiceSettings;
