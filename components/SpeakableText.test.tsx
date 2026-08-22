import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Language } from '../types';
import type { SpeechSegment } from '../services/tts/types';
import SpeakableText from './SpeakableText';

const segments: SpeechSegment[] = [
  {
    id: 'article-0-0',
    displayText: 'Hallo, Welt!',
    spokenText: 'Hallo, Welt!',
    visibleSentenceId: 'article-0',
  },
  {
    id: 'article-1-0',
    displayText: 'Wie geht es dir?',
    spokenText: 'Wie geht es dir?',
    visibleSentenceId: 'article-1',
  },
];

describe('SpeakableText', () => {
  it('marks the active visible sentence with semantic and accessible state', () => {
    render(<SpeakableText segments={segments} language={Language.German} activeSegmentId="article-1" />);
    const visibleSentences = screen.getAllByTestId('visible-sentence');

    expect(visibleSentences[0].getAttribute('data-active-sentence')).not.toBe('true');
    expect(visibleSentences[0].getAttribute('aria-current')).toBeNull();
    expect(visibleSentences[1].getAttribute('data-active-sentence')).toBe('true');
    expect(visibleSentences[1].getAttribute('aria-current')).toBe('true');
  });

  it('calls onWordClick with the cleaned clicked word', () => {
    const onWordClick = vi.fn();
    render(<SpeakableText segments={segments} language={Language.German} activeSegmentId={null} onWordClick={onWordClick} />);

    fireEvent.click(screen.getByText('Hallo'));

    expect(onWordClick).toHaveBeenCalledWith('hallo', expect.any(Object));
  });

  it('renders a visible sentence once when it has multiple internal audio chunks', () => {
    render(
      <SpeakableText
        segments={[
          { ...segments[0], id: 'article-0-0' },
          { ...segments[0], id: 'article-0-1', spokenText: 'Welt!' },
        ]}
        language={Language.German}
        activeSegmentId="article-0"
      />,
    );

    const visibleSentences = screen.getAllByTestId('visible-sentence');
    expect(visibleSentences).toHaveLength(1);
    expect(visibleSentences[0].textContent).toBe('Hallo, Welt!');
  });
});
