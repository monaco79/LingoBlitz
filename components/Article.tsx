import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { PlaybackSnapshot } from '../services/tts/playbackController';
import { createSpeechSegments } from '../services/tts/textSegments';
import * as ttsService from '../services/ttsService';
import { Language, Level, type TTSSettings } from '../types';
import SpeakableText from './SpeakableText';

interface ArticleProps {
  title: string;
  content: string;
  level: Level;
  ttsSettings: TTSSettings;
  language: Language;
  onWordClick: (word: string, event: React.MouseEvent<HTMLSpanElement>) => void;
  onFallback: () => void;
}

const Article: React.FC<ArticleProps> = ({
  title,
  content,
  level,
  ttsSettings,
  language,
  onWordClick,
  onFallback,
}) => {
  const [playback, setPlayback] = useState<PlaybackSnapshot>(() => ttsService.getPlaybackSnapshot());
  const titleSegments = useMemo(
    () => createSpeechSegments(title, language, 'article-title'),
    [language, title],
  );
  const paragraphs = useMemo(
    () => content.split('\n').flatMap((paragraph, paragraphIndex) => {
      if (!paragraph.trim()) return [];
      return [{
        key: `article-paragraph-${paragraphIndex}`,
        segments: createSpeechSegments(paragraph, language, `article-body-${paragraphIndex}`),
      }];
    }),
    [content, language],
  );
  const playbackSegments = useMemo(
    () => [...titleSegments, ...paragraphs.flatMap(({ segments }) => segments)]
      .filter(({ spokenText }) => spokenText.length > 0),
    [paragraphs, titleSegments],
  );

  useEffect(() => ttsService.subscribeToPlayback(setPlayback), []);

  useEffect(() => () => {
    ttsService.stopSpeech();
  }, [content, language, title]);

  const play = useCallback(() => {
    if (playbackSegments.length === 0) return;
    void ttsService.speakSegments({
      segments: playbackSegments,
      language,
      settings: ttsSettings,
      onFallback,
    }).catch((error: unknown) => {
      console.error('TTS playback failed', error);
    });
  }, [language, onFallback, playbackSegments, ttsSettings]);

  useEffect(() => {
    if (!ttsSettings.autoRead || playbackSegments.length === 0) return undefined;
    const timer = window.setTimeout(play, 800);
    return () => window.clearTimeout(timer);
  }, [play, playbackSegments.length, ttsSettings.autoRead]);

  const handleWordClick = useCallback((word: string, event: React.MouseEvent<HTMLSpanElement>) => {
    ttsService.stopSpeech();
    onWordClick(word, event);
  }, [onWordClick]);

  const isActive = playback.status !== 'idle';
  const isPaused = playback.status === 'paused';

  return (
    <div className="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-lingoblitz shadow-lg max-w-4xl w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{level}</span>
        </div>

        <div className="flex items-center gap-2">
          {isActive ? (
            <>
              <button
                type="button"
                onClick={isPaused ? ttsService.resumeSpeech : ttsService.pauseSpeech}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-200"
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={ttsService.stopSpeech}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-200"
                title="Stop"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={play}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-200"
              title="Play"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">
        <SpeakableText
          segments={titleSegments}
          language={language}
          activeSegmentId={playback.activeSegmentId}
          onWordClick={handleWordClick}
        />
      </h2>

      <div className="font-aleo text-lg md:text-xl leading-relaxed text-gray-700 dark:text-gray-300 space-y-4">
        {paragraphs.map(({ key, segments }) => (
          <p key={key}>
            <SpeakableText
              segments={segments}
              language={language}
              activeSegmentId={playback.activeSegmentId}
              onWordClick={handleWordClick}
            />
          </p>
        ))}
      </div>
    </div>
  );
};

export default Article;
