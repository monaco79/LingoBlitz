import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaybackRequest, PlaybackSnapshot } from '../services/tts/playbackController';
import { Language, Level, type TTSSettings } from '../types';
import Article from './Article';
import Quiz from './Quiz';

const tts = vi.hoisted(() => {
  const listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  let snapshot: PlaybackSnapshot = { status: 'idle', activeSegmentId: null, source: null };

  return {
    emit(next: PlaybackSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener(next));
    },
    getPlaybackSnapshot: vi.fn(() => snapshot),
    pauseSpeech: vi.fn(),
    reset() {
      listeners.clear();
      snapshot = { status: 'idle', activeSegmentId: null, source: null };
    },
    resumeSpeech: vi.fn(),
    speakSegments: vi.fn<(request: PlaybackRequest) => Promise<void>>(async () => undefined),
    stopSpeech: vi.fn(),
    subscribeToPlayback: vi.fn((nextListener: (next: PlaybackSnapshot) => void) => {
      listeners.add(nextListener);
      return () => listeners.delete(nextListener);
    }),
  };
});

vi.mock('../services/ttsService', () => ({
  getPlaybackSnapshot: tts.getPlaybackSnapshot,
  pauseSpeech: tts.pauseSpeech,
  resumeSpeech: tts.resumeSpeech,
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
  autoRead: false,
};

const renderArticle = (overrides: Partial<React.ComponentProps<typeof Article>> = {}) => {
  const props: React.ComponentProps<typeof Article> = {
    title: 'Ein Titel.',
    content: 'Erster Satz. Zweiter Satz.\nDritter Absatz.',
    level: Level.A2,
    ttsSettings: settings,
    language: Language.German,
    onWordClick: vi.fn(),
    onFallback: vi.fn(),
    isActiveSurface: true,
    isAutoReadReady: true,
    ...overrides,
  };

  return { props, ...render(<Article {...props} />) };
};

describe('Article sentence playback', () => {
  beforeEach(() => {
    tts.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits title and paragraph sentence segments in rendered order', () => {
    const onFallback = vi.fn();
    renderArticle({ onFallback });

    fireEvent.click(screen.getByTitle('Play'));

    expect(tts.speakSegments).toHaveBeenCalledTimes(1);
    const request = tts.speakSegments.mock.calls[0][0];
    expect(request.segments.map((segment) => segment.displayText.trim())).toEqual([
      'Ein Titel.',
      'Erster Satz.',
      'Zweiter Satz.',
      'Dritter Absatz.',
    ]);
    expect(request.segments.map((segment) => segment.id)).toEqual([
      'article-title-0-0',
      'article-body-0-0-0',
      'article-body-0-1-0',
      'article-body-1-0-0',
    ]);
    expect(request).toMatchObject({
      language: Language.German,
      settings,
      onFallback,
    });
  });

  it('marks only the controller active sentence', () => {
    renderArticle();

    act(() => {
      tts.emit({
        status: 'playing',
        activeSegmentId: 'article-body-0-1',
        source: 'voxtral',
      });
    });

    const sentences = screen.getAllByTestId('visible-sentence');
    expect(sentences.filter((sentence) => sentence.dataset.activeSentence === 'true')).toHaveLength(1);
    expect(
      screen.getByText('Zweiter').closest('[data-visible-sentence-id]')?.getAttribute('data-active-sentence'),
    ).toBe('true');
  });

  it('delegates pause, resume, and stop to the controller facade', () => {
    renderArticle();

    act(() => tts.emit({ status: 'playing', activeSegmentId: 'article-title-0', source: 'voxtral' }));
    fireEvent.click(screen.getByTitle('Pause'));
    expect(tts.pauseSpeech).toHaveBeenCalledTimes(1);

    act(() => tts.emit({ status: 'paused', activeSegmentId: 'article-title-0', source: 'voxtral' }));
    fireEvent.click(screen.getByTitle('Resume'));
    expect(tts.resumeSpeech).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Stop'));
    expect(tts.stopSpeech).toHaveBeenCalledTimes(1);
  });

  it('auto-reads a completed article once after content settles', () => {
    vi.useFakeTimers();
    const { props, rerender } = renderArticle({ ttsSettings: { ...settings, autoRead: true } });

    act(() => vi.advanceTimersByTime(800));
    expect(tts.speakSegments).toHaveBeenCalledTimes(1);

    rerender(<Article {...props} onFallback={() => undefined} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(tts.speakSegments).toHaveBeenCalledTimes(1);
  });

  it('does not replay auto-read after manual play wins the timer race', () => {
    vi.useFakeTimers();
    renderArticle({ ttsSettings: { ...settings, autoRead: true } });

    fireEvent.click(screen.getByTitle('Play'));
    expect(tts.speakSegments).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).toHaveBeenCalledTimes(1);
  });

  it.each(['Pause', 'Stop'])('cancels pending auto-read when the user chooses %s', (action) => {
    vi.useFakeTimers();
    renderArticle({ ttsSettings: { ...settings, autoRead: true } });
    act(() => tts.emit({ status: 'playing', activeSegmentId: 'article-title-0', source: 'voxtral' }));

    fireEvent.click(screen.getByTitle(action));
    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).not.toHaveBeenCalled();
  });

  it('does not auto-read partial streaming content or after the surface becomes inactive', () => {
    vi.useFakeTimers();
    const { props, rerender } = renderArticle({
      content: 'Teiltext.',
      isAutoReadReady: false,
      ttsSettings: { ...settings, autoRead: true },
    });

    act(() => vi.advanceTimersByTime(800));
    rerender(<Article {...props} content="Mehr Teiltext." isAutoReadReady={false} />);
    act(() => vi.advanceTimersByTime(800));
    expect(tts.speakSegments).not.toHaveBeenCalled();

    rerender(<Article {...props} content="Fertiger Text." isAutoReadReady />);
    act(() => vi.advanceTimersByTime(400));
    rerender(<Article {...props} content="Fertiger Text." isAutoReadReady isActiveSurface={false} />);
    act(() => vi.advanceTimersByTime(800));
    expect(tts.speakSegments).not.toHaveBeenCalled();
  });

  it('does not show controls for another simultaneously mounted speech surface', () => {
    renderArticle();

    act(() => tts.emit({ status: 'playing', activeSegmentId: 'quiz-question-0', source: 'voxtral' }));

    expect(screen.queryByTitle('Pause')).toBeNull();
    expect(screen.getByTitle('Play')).not.toBeNull();
  });

  it('keeps Article and Quiz controls scoped while both surfaces are mounted', () => {
    const articleProps: React.ComponentProps<typeof Article> = {
      title: 'Ein Titel.',
      content: 'Ein Artikel.',
      level: Level.A2,
      ttsSettings: settings,
      language: Language.German,
      onWordClick: vi.fn(),
      onFallback: vi.fn(),
      isActiveSurface: true,
      isAutoReadReady: true,
    };
    const quizProps: React.ComponentProps<typeof Quiz> = {
      question: 'Eine Frage?',
      onAnswerSubmit: vi.fn(),
      isEvaluating: false,
      feedback: null,
      onContinue: vi.fn(),
      onWordClick: vi.fn(),
      ttsSettings: settings,
      language: Language.German,
      hasVocabulary: false,
      onPracticeVocabulary: vi.fn(),
      hasCompletedVocabulary: false,
      onFallback: vi.fn(),
      isActiveSurface: true,
    };
    const { container } = render(
      <>
        <Article {...articleProps} />
        <Quiz {...quizProps} />
      </>,
    );
    const [articleRoot, quizRoot] = Array.from(container.children) as HTMLElement[];

    act(() => tts.emit({ status: 'playing', activeSegmentId: 'article-title-0', source: 'voxtral' }));
    expect(within(articleRoot).getByTitle('Pause')).not.toBeNull();
    expect(within(quizRoot).getByTitle('Play')).not.toBeNull();

    act(() => tts.emit({ status: 'playing', activeSegmentId: 'quiz-question-0', source: 'voxtral' }));
    expect(within(articleRoot).getByTitle('Play')).not.toBeNull();
    expect(within(quizRoot).getByTitle('Pause')).not.toBeNull();
  });

  it('stops playback before forwarding a clicked word', () => {
    const order: string[] = [];
    tts.stopSpeech.mockImplementation(() => order.push('stop'));
    const onWordClick = vi.fn(() => order.push('word'));
    renderArticle({ onWordClick });

    fireEvent.click(screen.getByText('Titel'));

    expect(order).toEqual(['stop', 'word']);
    expect(onWordClick).toHaveBeenCalledWith('titel', expect.any(Object));
  });

  it('cancels pending auto-read when a word is clicked', () => {
    vi.useFakeTimers();
    renderArticle({ ttsSettings: { ...settings, autoRead: true } });

    fireEvent.click(screen.getByText('Titel'));
    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).not.toHaveBeenCalled();
  });

  it('stops playback on content replacement and unmount', () => {
    const { props, rerender, unmount } = renderArticle();
    tts.stopSpeech.mockClear();

    rerender(<Article {...props} content="Ersatztext." />);
    expect(tts.stopSpeech).toHaveBeenCalledTimes(1);

    unmount();
    expect(tts.stopSpeech).toHaveBeenCalledTimes(2);
  });
});
