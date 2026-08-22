import React, { useState } from 'react';

import { ALL_LANGUAGES, ALL_LEVELS, ALL_TOPICS, LEVEL_TTS_SPEEDS } from '../constants';
import { isVoxtralSupported } from '../services/tts/languageConfig';
import { getTTSPreference, migrateTTSSettings } from '../services/tts/settings';
import { Language, Level, Topic, type UserSettings } from '../types';
import CloseIcon from './icons/CloseIcon';
import VoiceSettings from './VoiceSettings';

interface SettingsModalProps {
  currentSettings: UserSettings;
  onSave: (newSettings: UserSettings) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ currentSettings, onSave, onClose }) => {
  const [settings, setSettings] = useState<UserSettings>(() => ({
    ...currentSettings,
    tts: migrateTTSSettings(currentSettings.tts, currentSettings.learningLanguage),
  }));

  const updateSettings = <K extends keyof UserSettings,>(key: K, value: UserSettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const updateLevel = (level: Level) => {
    setSettings((previous) => ({
      ...previous,
      level,
      tts: { ...previous.tts, speed: LEVEL_TTS_SPEEDS[level] },
    }));
  };

  const toggleInterest = (interest: Topic) => {
    const nextInterests = settings.interests.includes(interest)
      ? settings.interests.filter((candidate) => candidate !== interest)
      : [...settings.interests, interest];
    updateSettings('interests', nextInterests);
  };

  const preference = getTTSPreference(settings.tts, settings.learningLanguage);
  const hasCompatibleVoice = preference.provider === 'voxtral'
    ? isVoxtralSupported(settings.learningLanguage) && Boolean(preference.voxtralVoiceId)
    : Boolean(preference.browserVoiceName);
  const canSave = settings.nativeLanguage !== settings.learningLanguage
    && settings.interests.length > 0
    && hasCompatibleVoice;

  return (
    <div className="fixed inset-0 bg-gray-900/50 dark:bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-lingoblitz shadow-2xl p-4 sm:p-8 relative max-h-[90vh] overflow-y-auto">
        <button type="button" onClick={onClose} aria-label="Close settings" className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">
          <CloseIcon />
        </button>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">Settings</h2>

        <div className="space-y-6">
          <SelectInput id="native-language" label="I speak..." value={settings.nativeLanguage} onChange={(event) => updateSettings('nativeLanguage', event.target.value as Language)} options={ALL_LANGUAGES} />
          <SelectInput id="learning-language" label="I want to learn..." value={settings.learningLanguage} onChange={(event) => updateSettings('learningLanguage', event.target.value as Language)} options={ALL_LANGUAGES} />
          {settings.nativeLanguage === settings.learningLanguage && <p className="text-red-500 dark:text-red-400 text-sm -mt-4">Languages must be different.</p>}

          <SelectInput id="learning-level" label="My level is..." value={settings.level} onChange={(event) => updateLevel(event.target.value as Level)} options={ALL_LEVELS} />

          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-300 mb-3">My Interests</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ALL_TOPICS.map((topic) => (
                <button
                  type="button"
                  key={topic}
                  onClick={() => toggleInterest(topic)}
                  className={`p-3 rounded-lingoblitz text-center transition-all duration-200 font-medium ${settings.interests.includes(topic)
                    ? 'gradient-lingoblitz text-white shadow-md'
                    : 'bg-white hover:bg-gray-50 text-gray-800 dark:text-white dark:bg-gray-700 dark:hover:bg-gray-600 border-2 border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>
            {settings.interests.length === 0 && <p className="text-red-500 dark:text-red-400 text-sm mt-2">Please select at least one interest.</p>}
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-300 mb-4">Voice Settings</h3>
            <VoiceSettings
              language={settings.learningLanguage}
              level={settings.level}
              value={settings.tts}
              onChange={(tts) => updateSettings('tts', tts)}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSave(settings)}
          disabled={!canSave}
          className="mt-8 gradient-lingoblitz hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 shadow-md"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
};

interface SelectInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
}

const SelectInput: React.FC<SelectInputProps> = ({ id, label, value, onChange, options }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</label>
    <select id={id} value={value} onChange={onChange} className="w-full bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lingoblitz py-3 px-4 focus:outline-none focus:ring-2 focus:ring-purple-400 text-gray-900 dark:text-white">
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </div>
);

export default SettingsModal;
