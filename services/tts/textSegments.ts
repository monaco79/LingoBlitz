import { LANGUAGE_TO_LOCALE } from '../../constants';
import type { Language } from '../../types';
import type { SpeechSegment } from './types';

const MAX_SPEECH_CHARACTERS = 2_000;
const MAX_SPEECH_WORDS = 250;
const SENTENCE_CLOSERS = new Set(['"', "'", '”', '’', '»', '）', ')', ']', '}']);
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof',
  'hr', 'herr', 'fr', 'frau',
  'm', 'mme', 'mlle', 'monsieur',
  'sr', 'sra', 'srta', 'dra', 'don', 'doña',
]);

type SentenceSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

type SentenceSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'sentence' },
) => SentenceSegmenter;

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export const normalizeSpeechText = (text: string): string => text
  .replace(/[*_`~]+/g, '')
  .replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

const attachWhitespaceSegments = (segments: string[]): string[] => {
  const visibleSegments: string[] = [];
  let pendingWhitespace = '';

  for (const segment of segments) {
    if (!segment.trim()) {
      pendingWhitespace += segment;
      continue;
    }

    const trailingWhitespace = segment.match(/\s+$/)?.[0] ?? '';
    const visibleText = trailingWhitespace ? segment.slice(0, -trailingWhitespace.length) : segment;
    visibleSegments.push(`${pendingWhitespace}${visibleText}`);
    pendingWhitespace = trailingWhitespace;
  }

  if (pendingWhitespace && visibleSegments.length > 0) {
    visibleSegments[visibleSegments.length - 1] += pendingWhitespace;
  }

  return visibleSegments;
};

const endsWithHonorific = (text: string): boolean => {
  const word = text.trim().match(/([\p{L}]+)\.$/u)?.[1]?.toLocaleLowerCase();
  return word !== undefined && HONORIFICS.has(word);
};

const mergeHonorificFragments = (segments: string[]): string[] => {
  const merged: string[] = [];

  for (const segment of segments) {
    if (merged.length > 0 && endsWithHonorific(merged[merged.length - 1])) {
      merged[merged.length - 1] += segment;
    } else {
      merged.push(segment);
    }
  }

  return merged;
};

const precedingWord = (text: string, index: number): string =>
  text.slice(0, index).match(/[\p{L}]+$/u)?.[0]?.toLocaleLowerCase() ?? '';

const isProtectedPeriod = (text: string, index: number): boolean => {
  const word = precedingWord(text, index);
  return HONORIFICS.has(word) || /\d$/.test(text.slice(0, index));
};

const fallbackSentenceSegments = (text: string): string[] => {
  const segments: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const isTerminal = character === '.' || character === '!' || character === '?' || character === '。' || character === '！' || character === '？';

    if (!isTerminal || (character === '.' && isProtectedPeriod(text, index))) continue;

    let end = index + 1;
    while (end < text.length && (text[end] === '.' || text[end] === '!' || text[end] === '?' || SENTENCE_CLOSERS.has(text[end]))) {
      end += 1;
    }

    segments.push(text.slice(start, end));
    start = end;
    index = end - 1;
  }

  if (start < text.length) segments.push(text.slice(start));
  return attachWhitespaceSegments(segments);
};

const visibleSentenceSegments = (text: string, language: Language): string[] => {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SentenceSegmenterConstructor }).Segmenter;

  if (!Segmenter) return fallbackSentenceSegments(text);

  try {
    const segmenter = new Segmenter(LANGUAGE_TO_LOCALE[language] ?? 'en-US', { granularity: 'sentence' });
    return attachWhitespaceSegments(mergeHonorificFragments(
      Array.from(segmenter.segment(text), ({ segment }) => segment),
    ));
  } catch {
    return fallbackSentenceSegments(text);
  }
};

const splitOversizedText = (spokenText: string): string[] => {
  if (spokenText.length <= MAX_SPEECH_CHARACTERS && wordCount(spokenText) <= MAX_SPEECH_WORDS) {
    return [spokenText];
  }

  const chunks: string[] = [];
  let current = '';
  const clauses = spokenText.match(/[^,;:—–]+(?:[,;:—–]+|$)/g) ?? [spokenText];

  const append = (unit: string) => {
    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length <= MAX_SPEECH_CHARACTERS && wordCount(candidate) <= MAX_SPEECH_WORDS) {
      current = candidate;
      return;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (unit.length <= MAX_SPEECH_CHARACTERS && wordCount(unit) <= MAX_SPEECH_WORDS) {
      current = unit;
      return;
    }

    for (const word of unit.split(/\s+/).filter(Boolean)) {
      if (word.length > MAX_SPEECH_CHARACTERS) {
        if (current) chunks.push(current);
        for (let start = 0; start < word.length; start += MAX_SPEECH_CHARACTERS) {
          chunks.push(word.slice(start, start + MAX_SPEECH_CHARACTERS));
        }
        current = '';
      } else {
        append(word);
      }
    }
  };

  for (const clause of clauses) {
    const normalizedClause = clause.trim();
    if (normalizedClause) append(normalizedClause);
  }
  if (current) chunks.push(current);

  return chunks;
};

export const createSpeechSegments = (
  text: string,
  language: Language,
  idPrefix: string,
): SpeechSegment[] => visibleSentenceSegments(text, language)
  .filter((displayText) => displayText.trim().length > 0)
  .flatMap((displayText, visibleIndex) => {
    const spokenText = normalizeSpeechText(displayText);
    if (!spokenText) return [];

    const visibleSentenceId = `${idPrefix}-${visibleIndex}`;
    return splitOversizedText(spokenText).map((chunk, chunkIndex) => ({
      id: `${visibleSentenceId}-${chunkIndex}`,
      displayText,
      spokenText: chunk,
      visibleSentenceId,
    }));
  });
