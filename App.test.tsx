import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaybackSnapshot } from './services/tts/playbackController';
import type { TTSVoiceOption } from './services/tts/types';
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

const tts = vi.hoisted(() => {
  let listener: ((snapshot: PlaybackSnapshot) => void) | null = null;
  let snapshot: PlaybackSnapshot = { status: 'idle', activeSegmentId: null, source: null, ownerId: null };
  return {
    emit(next: PlaybackSnapshot) {
      snapshot = next;
      listener?.(next);
    },
    getPlaybackSnapshot: vi.fn(() => snapshot),
    getVoicesForLanguage: vi.fn(),
    reset() {
      listener = null;
      snapshot = { status: 'idle', activeSegmentId: null, source: null, ownerId: null };
    },
    speakText: vi.fn<(request: SpeakTextRequest) => Promise<void>>(async () => undefined),
    stopSpeech: vi.fn(),
    subscribeToPlayback: vi.fn((nextListener: (next: PlaybackSnapshot) => void) => {
      listener = nextListener;
      return () => {
        if (listener === nextListener) listener = null;
      };
    }),
    subscribeToVoiceChanges: vi.fn(() => () => undefined),
  };
});

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
    tts.reset();
    vi.clearAllMocks();
    ai.translateWord.mockResolvedValue('translation');
    tts.speakText.mockResolvedValue(undefined);
    const spanishVoice: TTSVoiceOption = {
      id: 'spanish-one',
      name: 'Spanish One',
      displayName: 'Spanish One',
      provider: 'voxtral',
      languages: ['es'],
    };
    tts.getVoicesForLanguage.mockResolvedValue([spanishVoice]);
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
      idPrefix: expect.stringMatching(/^clicked-word-\d+$/),
      ownerId: expect.stringMatching(/^clicked-word-\d+$/),
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
      onVoxtralVoiceResolved: expect.any(Function),
    });
  });

  it('persists a lazily resolved migrated Voxtral voice without changing other preferences', async () => {
    storeSettings(Language.German, {
      preferences: {
        [Language.German]: {
          provider: 'voxtral',
          voxtralVoiceId: '',
          browserVoiceName: 'Legacy Anna',
        },
        [Language.Japanese]: {
          provider: 'browser',
          voxtralVoiceId: '',
          browserVoiceName: 'Kyoko',
        },
      },
      speed: 0.7,
      autoRead: true,
    });
    tts.speakText.mockImplementation(async (request) => {
      const resolvable = request as SpeakTextRequest & {
        onVoxtralVoiceResolved?: (language: Language, voiceId: string) => void;
      };
      resolvable.onVoxtralVoiceResolved?.(Language.German, 'german-first');
    });
    await renderReadyApp();

    fireEvent.click(screen.getByText('Reisen'));

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('lingoBlitzSettings') ?? '{}');
      expect(saved.tts.preferences[Language.German]).toEqual({
        provider: 'voxtral',
        voxtralVoiceId: 'german-first',
        browserVoiceName: 'Legacy Anna',
      });
      expect(saved.tts.preferences[Language.Japanese]).toEqual({
        provider: 'browser',
        voxtralVoiceId: '',
        browserVoiceName: 'Kyoko',
      });
      expect(saved.tts.speed).toBe(0.7);
      expect(saved.tts.autoRead).toBe(true);
    });
  });

  it('gives clicked-word speech an addressable popup unit and highlights it from the controller snapshot', async () => {
    storeSettings(Language.German, { voice: 'Legacy Anna', speed: 0.8, autoRead: true });
    await renderReadyApp();

    fireEvent.click(screen.getByText('Reisen'));
    const request = tts.speakText.mock.calls[0][0];
    expect(request.ownerId).toBe(request.idPrefix);
    const visibleSentenceId = `${request.idPrefix}-0`;
    const popupWord = screen.getByText('reisen');
    expect(popupWord.closest('[data-visible-sentence-id]')?.getAttribute('data-visible-sentence-id'))
      .toBe(visibleSentenceId);

    act(() => tts.emit({
      status: 'playing',
      activeSegmentId: visibleSentenceId,
      source: 'voxtral',
      ownerId: request.ownerId,
    }));

    expect(popupWord.closest('[data-visible-sentence-id]')?.getAttribute('data-active-sentence')).toBe('true');
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

  it('uses the App-owned fallback notice for an Onboarding voice preview', async () => {
    const user = userEvent.setup();
    tts.speakText.mockImplementation(async (request) => request.onFallback?.());
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: Topic.Travel }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('option', { name: 'Spanish One' });
    await user.click(screen.getByRole('button', { name: 'Play sample' }));

    expect(await screen.findByRole('status')).not.toBeNull();
  });
});
