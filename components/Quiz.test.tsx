import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaybackRequest, PlaybackSnapshot } from '../services/tts/playbackController';
import { Language, type TTSSettings } from '../types';
import Quiz from './Quiz';

const tts = vi.hoisted(() => {
  let listener: ((snapshot: PlaybackSnapshot) => void) | null = null;
  let snapshot: PlaybackSnapshot = { status: 'idle', activeSegmentId: null, source: null, ownerId: null };
  return {
    emit(next: PlaybackSnapshot) {
      snapshot = next;
      listener?.(next);
    },
    getPlaybackSnapshot: vi.fn(() => snapshot),
    pauseSpeech: vi.fn(),
    reset() {
      listener = null;
      snapshot = { status: 'idle', activeSegmentId: null, source: null, ownerId: null };
    },
    resumeSpeech: vi.fn(),
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

const renderQuiz = (overrides: Partial<React.ComponentProps<typeof Quiz>> = {}) => {
  const props: React.ComponentProps<typeof Quiz> = {
    question: 'Was ist neu? Erkläre es.',
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
    ...overrides,
  };
  return { props, ...render(<Quiz {...props} />) };
};

describe('Quiz sentence playback', () => {
  beforeEach(() => {
    tts.reset();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    { label: 'question', feedback: null, prefix: 'quiz-question', text: 'Was ist neu? Erkläre es.' },
    { label: 'feedback', feedback: 'Sehr gut. Weiter so!', prefix: 'quiz-feedback', text: 'Sehr gut. Weiter so!' },
  ])('auto-reads the current $label with stable sentence units', ({ feedback, prefix, text }) => {
    vi.useFakeTimers();
    const onFallback = vi.fn();
    renderQuiz({ feedback, onFallback, ttsSettings: { ...settings, autoRead: true } });

    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).toHaveBeenCalledTimes(1);
    const request = tts.speakSegments.mock.calls[0][0];
    expect(request.segments.map((segment) => segment.displayText.trim()).join(' ')).toBe(text);
    expect(request.segments.every((segment) => segment.id.startsWith(prefix))).toBe(true);
    expect(request).toMatchObject({
      ownerId: 'quiz',
      language: Language.German,
      settings: { ...settings, autoRead: true },
      onFallback,
    });
  });

  it('highlights the active sentence and delegates pause, resume, and stop', () => {
    renderQuiz();

    act(() => tts.emit({ status: 'playing', activeSegmentId: 'quiz-question-1', source: 'voxtral', ownerId: 'quiz' }));
    const activeSentence = screen.getByText('Erkläre').closest('[data-visible-sentence-id]');
    expect(activeSentence?.getAttribute('data-active-sentence')).toBe('true');
    expect(screen.getAllByTestId('visible-sentence').filter((node) => node.dataset.activeSentence === 'true')).toHaveLength(1);

    fireEvent.click(screen.getByTitle('Pause'));
    expect(tts.pauseSpeech).toHaveBeenCalledTimes(1);
    act(() => tts.emit({ status: 'paused', activeSegmentId: 'quiz-question-1', source: 'voxtral', ownerId: 'quiz' }));
    fireEvent.click(screen.getByTitle('Resume'));
    expect(tts.resumeSpeech).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('Stop'));
    expect(tts.stopSpeech).toHaveBeenCalledTimes(1);
  });

  it('stops before forwarding a word click and before submitting an answer', () => {
    const order: string[] = [];
    tts.stopSpeech.mockImplementation(() => order.push('stop'));
    const onWordClick = vi.fn(() => order.push('word'));
    const onAnswerSubmit = vi.fn(() => order.push('submit'));
    renderQuiz({ onWordClick, onAnswerSubmit });

    fireEvent.click(screen.getByText('Erkläre'));
    expect(order).toEqual(['stop', 'word']);

    fireEvent.change(screen.getByPlaceholderText('Type your answer here...'), { target: { value: 'Meine Antwort' } });
    fireEvent.click(screen.getByRole('button', { name: /submit your answer/i }));
    expect(order).toEqual(['stop', 'word', 'stop', 'submit']);
    expect(onAnswerSubmit).toHaveBeenCalledWith('Meine Antwort');
  });

  it.each([
    { action: 'manual play', run: () => fireEvent.click(screen.getByTitle('Play')) },
    { action: 'word click', run: () => fireEvent.click(screen.getByText('Erkläre')) },
    { action: 'submit', run: () => {
      fireEvent.change(screen.getByPlaceholderText('Type your answer here...'), { target: { value: 'Antwort' } });
      fireEvent.click(screen.getByRole('button', { name: /submit your answer/i }));
    } },
  ])('cancels pending question auto-read after $action', ({ run }) => {
    vi.useFakeTimers();
    renderQuiz({ ttsSettings: { ...settings, autoRead: true } });

    run();
    const callsAfterAction = tts.speakSegments.mock.calls.length;
    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).toHaveBeenCalledTimes(callsAfterAction);
  });

  it.each(['Pause', 'Stop'])('cancels pending question auto-read after %s', (action) => {
    vi.useFakeTimers();
    renderQuiz({ ttsSettings: { ...settings, autoRead: true } });
    act(() => tts.emit({ status: 'playing', activeSegmentId: 'quiz-question-0', source: 'voxtral', ownerId: 'quiz' }));

    fireEvent.click(screen.getByTitle(action));
    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).not.toHaveBeenCalled();
  });

  it('cancels pending auto-read when the Quiz surface becomes inactive', () => {
    vi.useFakeTimers();
    const { props, rerender } = renderQuiz({ ttsSettings: { ...settings, autoRead: true } });

    act(() => vi.advanceTimersByTime(400));
    rerender(<Quiz {...props} isActiveSurface={false} />);
    act(() => vi.advanceTimersByTime(800));

    expect(tts.speakSegments).not.toHaveBeenCalled();
  });

  it('does not show controls for Article playback mounted at the same time', () => {
    renderQuiz();

    act(() => tts.emit({ status: 'playing', activeSegmentId: 'article-body-0-0', source: 'voxtral', ownerId: 'article' }));

    expect(screen.queryByTitle('Pause')).toBeNull();
    expect(screen.getByTitle('Play')).not.toBeNull();
  });

  it('preserves Markdown emphasis in display while speaking clean sentence text', () => {
    renderQuiz({ feedback: 'Das ist **sehr gut**. Weiter so!' });

    const emphasizedWord = screen.getByText('sehr');
    expect(emphasizedWord.closest('strong')).not.toBeNull();
    fireEvent.click(screen.getByTitle('Play'));
    const request = tts.speakSegments.mock.calls[0][0];
    expect(request.segments[0].displayText).toContain('**sehr gut**');
    expect(request.segments[0].spokenText).toBe('Das ist sehr gut.');
  });

  it.each([
    { feedback: '**Richtig!** Das passt.', tagName: 'strong' },
    { feedback: '*Richtig!* Das passt.', tagName: 'em' },
  ])('keeps punctuation inside Markdown emphasis for $tagName display and clean speech', ({
    feedback,
    tagName,
  }) => {
    renderQuiz({ feedback });

    const visibleSentences = screen.getAllByTestId('visible-sentence');
    expect(visibleSentences.map(({ textContent }) => textContent)).toEqual(['Richtig!', ' Das passt.']);
    expect(visibleSentences[0].querySelector(tagName)?.textContent).toBe('Richtig!');
    expect(visibleSentences.map(({ textContent }) => textContent).join('')).not.toContain('*');

    fireEvent.click(screen.getByTitle('Play'));
    const request = tts.speakSegments.mock.calls[0][0];
    expect(request.segments).toMatchObject([
      { displayText: expect.stringContaining('Richtig!'), spokenText: 'Richtig!' },
      { displayText: ' Das passt.', spokenText: 'Das passt.' },
    ]);
  });

  it.each([
    {
      feedback: 'Vorher. **Richtig!** Das passt.',
      emphasizedText: 'Richtig!',
      clickedWord: 'richtig',
      tagName: 'strong',
      visibleText: ['Vorher.', ' Richtig!', ' Das passt.'],
      spokenText: ['Vorher.', 'Richtig!', 'Das passt.'],
    },
    {
      feedback: 'Vorher. *Wirklich?* Danach.',
      emphasizedText: 'Wirklich?',
      clickedWord: 'wirklich',
      tagName: 'em',
      visibleText: ['Vorher.', ' Wirklich?', ' Danach.'],
      spokenText: ['Vorher.', 'Wirklich?', 'Danach.'],
    },
  ])('renders a complete $tagName token after an earlier sentence and speaks it without markers', ({
    feedback,
    emphasizedText,
    clickedWord,
    tagName,
    visibleText,
    spokenText,
  }) => {
    const onWordClick = vi.fn();
    renderQuiz({ feedback, onWordClick });

    const visibleSentences = screen.getAllByTestId('visible-sentence');
    expect(visibleSentences.map(({ textContent }) => textContent)).toEqual(visibleText);
    expect(visibleSentences[1].querySelector(tagName)?.textContent).toBe(emphasizedText);
    expect(visibleSentences.map(({ textContent }) => textContent).join('')).not.toContain('*');

    fireEvent.click(screen.getByText(emphasizedText.slice(0, -1)));
    expect(onWordClick).toHaveBeenCalledWith(clickedWord, expect.anything());

    fireEvent.click(screen.getByTitle('Play'));
    const request = tts.speakSegments.mock.calls[0][0];
    expect(request.segments.map((segment) => segment.spokenText)).toEqual(spokenText);
    expect(request.segments.map((segment) => segment.displayText).join('')).toBe(feedback);
  });

  it('stops playback when speech content changes and when unmounted', () => {
    const { props, rerender, unmount } = renderQuiz();
    tts.stopSpeech.mockClear();

    rerender(<Quiz {...props} feedback="Neue Rückmeldung." />);
    expect(tts.stopSpeech).toHaveBeenCalledTimes(1);
    unmount();
    expect(tts.stopSpeech).toHaveBeenCalledTimes(2);
  });
});
