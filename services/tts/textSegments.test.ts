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

  it('keeps quoted speech and its reporting clause together in the fallback', () => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    const text = '“Hallo!”, sagte Ana.\nWie geht es dir?';

    const segments = createSpeechSegments(text, Language.German, 'quoted-fallback');

    expect(segments.map(({ displayText }) => displayText)).toEqual([
      '“Hallo!”, sagte Ana.',
      '\nWie geht es dir?',
    ]);
    expect(segments.map(({ displayText }) => displayText).join('')).toBe(text);
  });

  it.each([
    ['“Was?!”, sagte Ana. Weiter.', '“Was?!”, sagte Ana.'],
    ['“Nein!!”, sagte Ana. Weiter.', '“Nein!!”, sagte Ana.'],
    ['“Warte...”, sagte Ana. Weiter.', '“Warte...”, sagte Ana.'],
    ['“Warte…”, sagte Ana. Weiter.', '“Warte…”, sagte Ana.'],
  ])('keeps quoted terminal punctuation runs with their reporting clause in the fallback', (text, firstSentence) => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    expect(createSpeechSegments(text, Language.German, 'punctuation-fallback').map(({ displayText }) => displayText))
      .toEqual([firstSentence, ' Weiter.']);
  });

  it('treats a year-ending period as a sentence boundary in the fallback', () => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    expect(createSpeechSegments('It happened in 2020. Next sentence.', Language.English, 'year-fallback'))
      .toMatchObject([
        { displayText: 'It happened in 2020.' },
        { displayText: ' Next sentence.' },
      ]);
  });

  it('normalizes markup, emoji, and repeated whitespace only for speech', () => {
    expect(normalizeSpeechText('**Hallo** 👋  Welt')).toBe('Hallo Welt');
  });

  it('preserves visible silent text with an empty spoken unit', () => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    const text = 'Hello. 👋';
    const segments = createSpeechSegments(text, Language.English, 'silent');

    expect(segments).toMatchObject([
      { id: 'silent-0-0', displayText: 'Hello.', spokenText: 'Hello.' },
      { id: 'silent-1-0', displayText: ' 👋', spokenText: '' },
    ]);
    expect(segments.map(({ displayText }) => displayText).join('')).toBe(text);
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
