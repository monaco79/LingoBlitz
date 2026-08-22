import { Language } from '../types';
import { LANGUAGE_TO_LOCALE } from '../constants';

export const cleanWord = (word: string): string => {
    return word.trim().replace(/^['".,!?;:]+|['".,!?;:]+$/g, '').toLowerCase();
};

export interface TextSegment {
    text: string;
    isWord: boolean;
}

interface WordSegmenter {
    segment(text: string): Iterable<{ segment: string; isWordLike: boolean }>;
}

type WordSegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: 'word' },
) => WordSegmenter;

export const segmentText = (text: string, language: Language): TextSegment[] => {
    const locale = LANGUAGE_TO_LOCALE[language] || 'en-US';

    // Check for Intl.Segmenter support
    const Segmenter = (Intl as typeof Intl & { Segmenter?: WordSegmenterConstructor }).Segmenter;
    if (Segmenter) {
        const segmenter = new Segmenter(locale, { granularity: 'word' });
        const segments = [...segmenter.segment(text)];

        return segments.map((seg) => ({
            text: seg.segment,
            isWord: seg.isWordLike
        }));
    }

    // Fallback for environments without Intl.Segmenter (though most modern browsers support it)
    // or for languages where simple splitting is sufficient if Segmenter fails.
    // This fallback mimics the previous regex-based splitting.
    const parts = text.split(/(\s+|[.,!?;:"()])/).filter(Boolean);
    return parts.map(part => {
        const cleaned = cleanWord(part);
        const isWord = /\w/.test(cleaned) || (language === Language.Chinese || language === Language.Japanese);
        // Note: The regex fallback is poor for CJK, but it's a fallback.

        return {
            text: part,
            isWord: isWord && part.trim().length > 0
        };
    });
};
