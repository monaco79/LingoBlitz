import React, { useState } from 'react';

import { ALL_LANGUAGES, ALL_LEVELS, ALL_TOPICS, LEVEL_TTS_SPEEDS } from '../constants';
import { isVoxtralSupported } from '../services/tts/languageConfig';
import { createDefaultTTSSettings, getTTSPreference } from '../services/tts/settings';
import { Language, Level, Topic, type UserSettings } from '../types';
import VoiceSettings from './VoiceSettings';

interface OnboardingProps {
  onComplete: (settings: UserSettings) => void;
  onFallback: () => void;
}

const INITIAL_LEVEL = Level.A2;

const Onboarding: React.FC<OnboardingProps> = ({ onComplete, onFallback }) => {
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<UserSettings>({
    nativeLanguage: Language.English,
    learningLanguage: Language.Spanish,
    level: INITIAL_LEVEL,
    interests: [],
    blitzedTopics: [],
    tts: createDefaultTTSSettings(Language.Spanish, LEVEL_TTS_SPEEDS[INITIAL_LEVEL]),
  });

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

  const hasCompatibleVoice = () => {
    const preference = getTTSPreference(settings.tts, settings.learningLanguage);
    return preference.provider === 'voxtral'
      ? isVoxtralSupported(settings.learningLanguage) && Boolean(preference.voxtralVoiceId)
      : true;
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return settings.nativeLanguage !== settings.learningLanguage;
      case 2:
        return Boolean(settings.level);
      case 3:
        return settings.interests.length > 0;
      case 4:
        return hasCompatibleVoice();
      default:
        return false;
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">Welcome to <span className="text-gradient-lingoblitz">LingoBlitz</span>!</h2>
            <p className="mb-6 text-gray-600 dark:text-gray-400">Let's set up your learning journey.</p>
            <div className="space-y-4">
              <SelectInput id="onboarding-native-language" label="I speak..." value={settings.nativeLanguage} onChange={(event) => updateSettings('nativeLanguage', event.target.value as Language)} options={ALL_LANGUAGES} />
              <SelectInput id="onboarding-learning-language" label="I want to learn..." value={settings.learningLanguage} onChange={(event) => updateSettings('learningLanguage', event.target.value as Language)} options={ALL_LANGUAGES} />
            </div>
            {settings.nativeLanguage === settings.learningLanguage && <p className="text-red-500 dark:text-red-400 text-sm mt-2">Native and learning languages must be different.</p>}
          </div>
        );
      case 2:
        return (
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">What is your current level?</h2>
            <div className="space-y-4">
              <SelectInput id="onboarding-level" label="My level in my learning language is..." value={settings.level} onChange={(event) => updateLevel(event.target.value as Level)} options={ALL_LEVELS} />
            </div>
          </div>
        );
      case 3:
        return (
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">What are you interested in?</h2>
            <p className="mb-6 text-gray-600 dark:text-gray-400">Select at least one to personalize your articles.</p>
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
          </div>
        );
      case 4:
        return (
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">Voice Settings</h2>
            <p className="mb-6 text-gray-600 dark:text-gray-400">Choose how you want to hear {settings.learningLanguage}.</p>
            <VoiceSettings
              language={settings.learningLanguage}
              level={settings.level}
              value={settings.tts}
              onChange={(tts) => updateSettings('tts', tts)}
              onFallback={onFallback}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-2xl p-4 sm:p-8 bg-white dark:bg-gray-800 rounded-lingoblitz shadow-2xl">
        {renderStep()}
        <div className="flex justify-between mt-8">
          {step > 1 ? (
            <button type="button" onClick={() => setStep((current) => current - 1)} className="bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 border-2 border-[#6263C4] text-gray-800 dark:text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200">
              Back
            </button>
          ) : <div />}
          {step < 4 ? (
            <button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canProceed()} className="gradient-lingoblitz hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 shadow-md">
              Next
            </button>
          ) : (
            <button type="button" onClick={() => onComplete(settings)} disabled={!canProceed()} className="gradient-lingoblitz hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 shadow-md">
              Start Learning!
            </button>
          )}
        </div>
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

export default Onboarding;
