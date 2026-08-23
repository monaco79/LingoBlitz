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
  renderEmphasis?: boolean;
}

const renderWords = (
  text: string,
  language: Language,
  keyPrefix: string,
  onWordClick?: (word: string, event: React.MouseEvent<HTMLSpanElement>) => void,
) => segmentText(text, language).map((segment, index) => {
  const cleanedWord = cleanWord(segment.text);
  const isClickable = segment.isWord && Boolean(onWordClick);

  return (
    <span
      key={`${keyPrefix}-word-${index}`}
      className={isClickable
        ? 'cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-md transition-colors duration-100 px-1 py-0.5 -mx-1 -my-0.5'
        : undefined}
      onClick={isClickable ? (event) => {
        if (cleanedWord) onWordClick?.(cleanedWord, event);
      } : undefined}
    >
      {segment.text}
    </span>
  );
});

const SpeakableText: React.FC<SpeakableTextProps> = ({
  segments,
  language,
  activeSegmentId,
  onWordClick,
  className,
  renderEmphasis = false,
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
        const isActive = visibleSentenceId === activeSegmentId;
        const displayParts = renderEmphasis
          ? visibleSegment.displayText.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)
          : [visibleSegment.displayText];

        return (
          <span
            key={visibleSentenceId}
            data-testid="visible-sentence"
            data-visible-sentence-id={visibleSentenceId}
            data-active-sentence={isActive ? 'true' : undefined}
            aria-current={isActive ? 'true' : undefined}
          >
            {displayParts.map((part, partIndex) => {
              const isStrong = renderEmphasis && part.startsWith('**') && part.endsWith('**');
              const isEmphasis = !isStrong && renderEmphasis && part.startsWith('*') && part.endsWith('*');
              const visibleText = isStrong ? part.slice(2, -2) : isEmphasis ? part.slice(1, -1) : part;
              const words = renderWords(
                visibleText,
                language,
                `${visibleSentenceId}-part-${partIndex}`,
                onWordClick,
              );

              if (isStrong) return <strong key={`${visibleSentenceId}-part-${partIndex}`}>{words}</strong>;
              if (isEmphasis) return <em key={`${visibleSentenceId}-part-${partIndex}`}>{words}</em>;
              return <React.Fragment key={`${visibleSentenceId}-part-${partIndex}`}>{words}</React.Fragment>;
            })}
          </span>
        );
      })}
    </span>
  );
};

export default SpeakableText;
