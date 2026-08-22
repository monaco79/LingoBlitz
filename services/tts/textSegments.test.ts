import { afterEach, describe, expect, it, vi } from 'vitest';

import { Language } from '../../types';
import { createSpeechSegments, normalizeSpeechText } from './textSegments';

describe('speech text segments', () => {
  const originalSegmenter = Intl.Segmenter;

  afterEach(() => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: originalSegmenter,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('keeps display sentences stable while assigning deterministic IDs', () => {
    expect(createSpeechSegments('Dr. Weber kommt. Er lernt.', Language.German, 'article'))
      .toMatchObject([
        { id: 'article-0-0', displayText: 'Dr. Weber kommt.', visibleSentenceId: 'article-0' },
        { id: 'article-1-0', displayText: ' Er lernt.', visibleSentenceId: 'article-1' },
      ]);
  });

  it('preserves quotation, terminal punctuation, and newlines in display text', () => {
    const text = '“Hallo!”, sagte Ana.\nWie geht es dir?';
    const segments = createSpeechSegments(text, Language.German, 'quote');

    expect(segments.map(({ displayText }) => displayText).join('')).toBe(text);
    expect(segments).toHaveLength(2);
    expect(segments[0].displayText).toContain('Hallo!');
    expect(segments[1].displayText).toContain('Wie geht es dir?');
  });

  it('returns no segments for empty display text', () => {
    expect(createSpeechSegments('', Language.English, 'empty')).toEqual([]);
    expect(createSpeechSegments('   ', Language.English, 'empty')).toEqual([]);
  });

  it('falls back without Intl.Segmenter while protecting common honorifics', () => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    expect(createSpeechSegments('Dr. Weber kommt. M. Dupont arrive. Sr. García llega.', Language.French, 'fallback'))
      .toMatchObject([
        { displayText: 'Dr. Weber kommt.' },
        { displayText: ' M. Dupont arrive.' },
        { displayText: ' Sr. García llega.' },
      ]);
  });

  it('normalizes markup, emoji, and repeated whitespace only for speech', () => {
    expect(normalizeSpeechText('**Hallo** 👋  Welt')).toBe('Hallo Welt');
  });

  it('splits oversized speech into bounded chunks without duplicating its visible sentence', () => {
    const text = `${Array.from({ length: 251 }, (_, index) => `word${index + 1}`).join(' ')}.`;
    const segments = createSpeechSegments(text, Language.English, 'long');

    expect(segments).toHaveLength(2);
    expect(segments.map(({ id }) => id)).toEqual(['long-0-0', 'long-0-1']);
    expect(segments.every(({ visibleSentenceId }) => visibleSentenceId === 'long-0')).toBe(true);
    expect(segments.every(({ displayText }) => displayText === text)).toBe(true);
    expect(segments.every(({ spokenText }) => spokenText.split(/\s+/).filter(Boolean).length <= 250)).toBe(true);
    expect(segments.every(({ spokenText }) => spokenText.length <= 2_000)).toBe(true);
  });
});
