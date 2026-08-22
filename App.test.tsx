import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpeakTextRequest } from './services/ttsService';
import { Language, Level, Topic } from './types';
import App from './App';

const ai = vi.hoisted(() => ({
  evaluateQuizAnswer: vi.fn(async () => 'Feedback.'),
  generateArticleStream: vi.fn(),
  generateQuizQuestion: vi.fn(async () => 'Eine Frage?'),
  generateTopicProposals: vi.fn(),
  translateWord: vi.fn(async () => 'translation'),
}));

const tts = vi.hoisted(() => ({
  speakText: vi.fn<(request: SpeakTextRequest) => Promise<void>>(async () => undefined),
  stopSpeech: vi.fn(),
}));

vi.mock('./services/aiService', () => ai);
vi.mock('./services/ttsService', () => tts);

const storeSettings = (learningLanguage: Language, rawTTS: unknown) => {
  localStorage.setItem('lingoBlitzSettings', JSON.stringify({
    nativeLanguage: Language.English,
    learningLanguage,
    level: Level.A2,
    interests: [Topic.Travel],
    blitzedTopics: [],
    tts: rawTTS,
  }));
};

const renderReadyApp = async (proposal = 'Reisen') => {
  ai.generateTopicProposals.mockResolvedValue([proposal, 'Essen']);
  render(<App />);
  await screen.findByRole('heading', { name: 'Choose Your Next Blitz!' });
};

describe('App TTS integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    ai.translateWord.mockResolvedValue('translation');
    tts.speakText.mockResolvedValue(undefined);
  });

  it('safely rejects malformed persisted settings and returns to onboarding', () => {
    localStorage.setItem('lingoBlitzSettings', '{malformed json');

    render(<App />);

    expect(screen.getByText(/Welcome to/)).not.toBeNull();
    expect(ai.generateTopicProposals).not.toHaveBeenCalled();
  });

  it('migrates legacy TTS storage before speaking a clicked word with complete current settings', async () => {
    storeSettings(Language.German, { voice: 'Legacy Anna', speed: 0.7, autoRead: true });
    await renderReadyApp();

    fireEvent.click(screen.getByText('Reisen'));

    expect(tts.speakText).toHaveBeenCalledExactlyOnceWith({
      text: 'reisen',
      idPrefix: 'word',
      language: Language.German,
      settings: {
        preferences: {
          [Language.German]: {
            provider: 'voxtral',
            voxtralVoiceId: '',
            browserVoiceName: 'Legacy Anna',
          },
        },
        speed: 0.7,
        autoRead: true,
      },
      onFallback: expect.any(Function),
    });
  });

  it('shows one safe fallback notice when the playback callback reports a real fallback', async () => {
    storeSettings(Language.German, { voice: 'Legacy Anna', speed: 0.8, autoRead: true });
    tts.speakText.mockImplementation(async (request) => {
      request.onFallback?.();
    });
    await renderReadyApp();

    fireEvent.click(screen.getByText('Reisen'));

    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe(
      'Voxtral ist gerade nicht verfügbar – Browser-Stimme wird verwendet.',
    );
  });

  it.each([
    { language: Language.Japanese, proposal: '旅行', voice: 'Kyoko' },
    { language: Language.Chinese, proposal: '旅行', voice: 'Ting-Ting' },
  ])('does not show a fallback notice when $language intentionally uses Browser', async ({ language, proposal, voice }) => {
    storeSettings(language, {
      preferences: {
        [language]: {
          provider: 'browser',
          voxtralVoiceId: '',
          browserVoiceName: voice,
        },
      },
      speed: 0.8,
      autoRead: true,
    });
    await renderReadyApp(proposal);

    fireEvent.click(screen.getByText(proposal));

    await waitFor(() => expect(tts.speakText).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stops current playback when navigating to a new learning state', async () => {
    storeSettings(Language.German, { voice: 'Legacy Anna', speed: 0.8, autoRead: false });
    await renderReadyApp();
    tts.stopSpeech.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'New Proposals' }));

    await waitFor(() => expect(tts.stopSpeech).toHaveBeenCalledTimes(1));
  });
});
