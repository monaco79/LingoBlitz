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

  it('removes Markdown links, headings, and unsupported controls only from speech', () => {
    const text = '## **Titel**\nLies [diesen Text](https://example.test/page).\u0007\u202E Weiter.';

    expect(normalizeSpeechText(text)).toBe('Titel Lies diesen Text. Weiter.');
    expect(createSpeechSegments(text, Language.German, 'normalized')
      .map(({ displayText }) => displayText).join('')).toBe(text);
    expect(createSpeechSegments(text, Language.German, 'normalized')
      .map(({ spokenText }) => spokenText).join(' ')).not.toMatch(/(?:##|https?:|\u0007|\u202E)/u);
  });

  it.each([
    ['bold', '**Richtig!** Das passt.', '**Richtig!**'],
    ['italic', '*Richtig!* Das passt.', '*Richtig!*'],
  ])('keeps punctuation and closing %s Markdown delimiters in the same visible sentence', (
    _style,
    text,
    firstDisplayText,
  ) => {
    const segments = createSpeechSegments(text, Language.German, 'feedback');

    expect(segments).toMatchObject([
      {
        id: 'feedback-0-0',
        visibleSentenceId: 'feedback-0',
        displayText: firstDisplayText,
        spokenText: 'Richtig!',
      },
      {
        id: 'feedback-1-0',
        visibleSentenceId: 'feedback-1',
        displayText: ' Das passt.',
        spokenText: 'Das passt.',
      },
    ]);
    expect(segments.map(({ displayText }) => displayText).join('')).toBe(text);
  });

  it.each([
    {
      label: 'bold',
      text: 'Vorher. **Richtig!** Das passt.',
      expected: [
        { displayText: 'Vorher.', spokenText: 'Vorher.' },
        { displayText: ' **Richtig!**', spokenText: 'Richtig!' },
        { displayText: ' Das passt.', spokenText: 'Das passt.' },
      ],
    },
    {
      label: 'italic',
      text: 'Vorher. *Wirklich?* Danach.',
      expected: [
        { displayText: 'Vorher.', spokenText: 'Vorher.' },
        { displayText: ' *Wirklich?*', spokenText: 'Wirklich?' },
        { displayText: ' Danach.', spokenText: 'Danach.' },
      ],
    },
  ])('keeps a complete $label Markdown token with the sentence after an earlier sentence', ({
    text,
    expected,
  }) => {
    const segments = createSpeechSegments(text, Language.German, 'feedback');

    expect(segments).toMatchObject(expected.map((segment, index) => ({
      id: `feedback-${index}-0`,
      visibleSentenceId: `feedback-${index}`,
      ...segment,
    })));
    expect(segments.map(({ displayText }) => displayText).join('')).toBe(text);
  });

  it('keeps multiple Markdown spans balanced among normally punctuated sentences', () => {
    const text = 'Start. **Ja!** Normal? *Wirklich?* Ende.';
    const segments = createSpeechSegments(text, Language.German, 'mixed');

    expect(segments).toMatchObject([
      { displayText: 'Start.', spokenText: 'Start.' },
      { displayText: ' **Ja!**', spokenText: 'Ja!' },
      { displayText: ' Normal?', spokenText: 'Normal?' },
      { displayText: ' *Wirklich?*', spokenText: 'Wirklich?' },
      { displayText: ' Ende.', spokenText: 'Ende.' },
    ]);
    expect(segments.map(({ displayText }) => displayText).join('')).toBe(text);
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
