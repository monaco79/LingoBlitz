import React from 'react';

import type { SpeechSegment } from '../services/tts/types';
import { cleanWord, segmentText } from '../utils/textProcessing';
import type { Language } from '../types';

interface SpeakableTextProps {
  segments: SpeechSegment[];
  language: Language;
  activeSegmentId: string | null;
  onWordClick?: (word: string, event: React.MouseEvent<HTMLSpanElement>) => void;
  className?: string;
}

const SpeakableText: React.FC<SpeakableTextProps> = ({
  segments,
  language,
  activeSegmentId,
  onWordClick,
  className,
}) => {
  const visibleSentences = new Map<string, SpeechSegment[]>();

  for (const segment of segments) {
    const group = visibleSentences.get(segment.visibleSentenceId);
    if (group) {
      group.push(segment);
    } else {
      visibleSentences.set(segment.visibleSentenceId, [segment]);
    }
  }

  return (
    <span className={className}>
      {[...visibleSentences.entries()].map(([visibleSentenceId, sentenceSegments]) => {
        const [visibleSegment] = sentenceSegments;
        const isActive = sentenceSegments.some(({ id }) => id === activeSegmentId);

        return (
          <span
            key={visibleSentenceId}
            data-testid="visible-sentence"
            data-visible-sentence-id={visibleSentenceId}
            data-active-sentence={isActive ? 'true' : undefined}
            aria-current={isActive ? 'true' : undefined}
          >
            {segmentText(visibleSegment.displayText, language).map((segment, index) => {
              const cleanedWord = cleanWord(segment.text);

              return (
                <span
                  key={`${visibleSentenceId}-word-${index}`}
                  className={segment.isWord ? 'cursor-pointer' : undefined}
                  onClick={(event) => {
                    if (segment.isWord && cleanedWord) onWordClick?.(cleanedWord, event);
                  }}
                >
                  {segment.text}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
};

export default SpeakableText;
