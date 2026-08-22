import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaybackRequest, PlaybackSnapshot } from '../services/tts/playbackController';
import { Language, type TTSSettings } from '../types';
import VocabularyPractice from './VocabularyPractice';

const tts = vi.hoisted(() => {
  let listener: ((snapshot: PlaybackSnapshot) => void) | null = null;
  let snapshot: PlaybackSnapshot = { status: 'idle', activeSegmentId: null, source: null };
  return {
    emit(next: PlaybackSnapshot) {
      snapshot = next;
      listener?.(next);
    },
    getPlaybackSnapshot: vi.fn(() => snapshot),
    reset() {
      listener = null;
      snapshot = { status: 'idle', activeSegmentId: null, source: null };
    },
    speakSegments: vi.fn<(request: PlaybackRequest) => Promise<void>>(async () => undefined),
    stopSpeech: vi.fn(),
    subscribeToPlayback: vi.fn((nextListener: (next: PlaybackSnapshot) => void) => {
      listener = nextListener;
      return () => {
        if (listener === nextListener) listener = null;
      };
    }),
  };
});

vi.mock('../services/ttsService', () => ({
  getPlaybackSnapshot: tts.getPlaybackSnapshot,
  speakSegments: tts.speakSegments,
  stopSpeech: tts.stopSpeech,
  subscribeToPlayback: tts.subscribeToPlayback,
}));

const settings: TTSSettings = {
  preferences: {
    [Language.German]: {
      provider: 'voxtral',
      voxtralVoiceId: 'voice-1',
      browserVoiceName: 'Anna',
    },
  },
  speed: 0.8,
  autoRead: true,
};

const vocabulary = [
  { word: 'Hallo', translation: 'hello' },
  { word: 'Tschüss', translation: 'goodbye' },
];

const renderPractice = (overrides: Partial<React.ComponentProps<typeof VocabularyPractice>> = {}) => {
  const props: React.ComponentProps<typeof VocabularyPractice> = {
    vocabulary,
    onComplete: vi.fn(),
    learningLanguage: Language.German,
    ttsSettings: settings,
    onFallback: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<VocabularyPractice {...props} />) };
};

describe('VocabularyPractice sentence playback', () => {
  beforeEach(() => {
    tts.reset();
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('auto-reads each current word with the selected settings and replaces playback on card change', () => {
    const onFallback = vi.fn();
    renderPractice({ onFallback });

    act(() => vi.advanceTimersByTime(300));
    expect(tts.speakSegments).toHaveBeenCalledTimes(1);
    expect(tts.speakSegments.mock.calls[0][0]).toMatchObject({
      language: Language.German,
      settings,
      onFallback,
      segments: [expect.objectContaining({ displayText: 'Hallo', spokenText: 'Hallo' })],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Keep practicing' }));
    act(() => vi.advanceTimersByTime(300));

    expect(tts.speakSegments).toHaveBeenCalledTimes(2);
    expect(tts.speakSegments.mock.calls[1][0].segments[0]).toMatchObject({
      displayText: 'Tschüss',
      spokenText: 'Tschüss',
    });
  });

  it('marks the front card while its sentence unit is active', () => {
    renderPractice();
    act(() => vi.advanceTimersByTime(300));
    const activeSegmentId = tts.speakSegments.mock.calls[0][0].segments[0].visibleSentenceId;

    act(() => tts.emit({ status: 'playing', activeSegmentId, source: 'voxtral' }));

    expect(screen.getByTestId('vocabulary-card-front').getAttribute('data-active-sentence')).toBe('true');
  });

  it.each(['I know it!', 'Keep practicing'])(
    'stops immediately and does not carry an active ID onto the replacement card after %s',
    (action) => {
      renderPractice();
      act(() => vi.advanceTimersByTime(300));
      const firstVisibleId = tts.speakSegments.mock.calls[0][0].segments[0].visibleSentenceId;
      act(() => tts.emit({ status: 'playing', activeSegmentId: firstVisibleId, source: 'voxtral' }));
      tts.stopSpeech.mockClear();

      fireEvent.click(screen.getByRole('button', { name: action }));

      expect(tts.stopSpeech).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('vocabulary-card-front').getAttribute('data-active-sentence')).toBeNull();
      act(() => vi.advanceTimersByTime(300));
      const secondVisibleId = tts.speakSegments.mock.calls[1][0].segments[0].visibleSentenceId;
      expect(secondVisibleId).not.toBe(firstVisibleId);
    },
  );

  it('stops playback when unmounted', () => {
    const { unmount } = renderPractice();
    tts.stopSpeech.mockClear();

    unmount();

    expect(tts.stopSpeech).toHaveBeenCalledTimes(1);
  });
});
