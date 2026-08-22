import React, { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import { TTSSettings, Language } from '../types';
import * as ttsService from '../services/ttsService';
import type { PlaybackSnapshot } from '../services/tts/playbackController';
import { createSpeechSegments } from '../services/tts/textSegments';
import SpeakableText from './SpeakableText';

interface QuizProps {
  question: string;
  onAnswerSubmit: (answer: string) => void;
  isEvaluating: boolean;
  feedback: string | null;
  onContinue: () => void;
  onWordClick?: (word: string, event: React.MouseEvent<HTMLSpanElement>) => void;
  ttsSettings: TTSSettings;
  language: Language;
  hasVocabulary: boolean;
  onPracticeVocabulary: () => void;
  hasCompletedVocabulary: boolean;
  onFallback: () => void;
}

const Quiz: React.FC<QuizProps> = ({
  question,
  onAnswerSubmit,
  isEvaluating,
  feedback,
  onContinue,
  onWordClick,
  ttsSettings,
  language,
  hasVocabulary,
  onPracticeVocabulary,
  hasCompletedVocabulary,
  onFallback,
}) => {
  const [answer, setAnswer] = useState('');
  const [playback, setPlayback] = useState<PlaybackSnapshot>(() => ttsService.getPlaybackSnapshot());
  const questionSegments = useMemo(
    () => createSpeechSegments(question.replace(/[*#_]/g, ''), language, 'quiz-question'),
    [language, question],
  );
  const feedbackSegments = useMemo(
    () => feedback
      ? createSpeechSegments(feedback.replace(/[*#_]/g, ''), language, 'quiz-feedback')
      : [],
    [feedback, language],
  );
  const currentSegments = feedback ? feedbackSegments : questionSegments;

  useEffect(() => ttsService.subscribeToPlayback(setPlayback), []);

  useEffect(() => () => {
    ttsService.stopSpeech();
  }, [feedback, language, question]);

  const handlePlay = useCallback(() => {
    const playableSegments = currentSegments.filter(({ spokenText }) => spokenText.length > 0);
    if (playableSegments.length === 0) return;
    void ttsService.speakSegments({
      segments: playableSegments,
      language,
      settings: ttsSettings,
      onFallback,
    }).catch((error: unknown) => {
      console.error('TTS playback failed', error);
    });
  }, [currentSegments, language, onFallback, ttsSettings]);

  useEffect(() => {
    if (!ttsSettings.autoRead || currentSegments.length === 0) return undefined;
    const timer = window.setTimeout(handlePlay, 800);
    return () => window.clearTimeout(timer);
  }, [currentSegments, handlePlay, ttsSettings.autoRead]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (answer.trim()) {
      ttsService.stopSpeech();
      onAnswerSubmit(answer.trim());
    }
  };

  const handleWordClick = useCallback((word: string, event: React.MouseEvent<HTMLSpanElement>) => {
    ttsService.stopSpeech();
    onWordClick?.(word, event);
  }, [onWordClick]);

  const isPlaying = playback.status !== 'idle';
  const isPaused = playback.status === 'paused';

  // Render helper for audio controls
  const renderAudioControls = () => (
    <div className="flex items-center gap-2">
      {isPlaying || isPaused ? (
        <>
          <button
            type="button"
            onClick={isPaused ? ttsService.resumeSpeech : ttsService.pauseSpeech}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-200"
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? (
              // Resume Icon
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              // Pause Icon
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
            {/* Corrected Stop Icon as requested */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handlePlay}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-200"
          title="Play"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        </button>
      )}
    </div>
  );

  // Determine button styles based on state
  const showPracticeButton = hasVocabulary && !hasCompletedVocabulary;
  const practiceButtonClass = "gradient-lingoblitz hover:opacity-90 text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 text-lg flex-1";

  // Next Blitz is secondary (white) if Practice is shown, otherwise primary (gradient)
  const nextBlitzButtonClass = showPracticeButton
    ? "bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 border-2 border-[#6263C4] text-gray-800 dark:text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 text-lg flex-1"
    : "gradient-lingoblitz hover:opacity-90 text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 text-lg flex-1";

  return (
    <div className="w-full max-w-4xl p-6 md:p-8 bg-white dark:bg-gray-800 rounded-lingoblitz shadow-lg flex flex-col gap-6">
      {!feedback ? (
        // QUESTION VIEW
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Quiz time!</h2>
              {renderAudioControls()}
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-lg font-aleo">
              <SpeakableText
                segments={questionSegments}
                language={language}
                activeSegmentId={playback.activeSegmentId}
                onWordClick={onWordClick ? handleWordClick : undefined}
              />
            </p>
          </div>

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here..."
            className="w-full h-32 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lingoblitz py-3 px-4 focus:outline-none focus:ring-2 focus:ring-purple-400 text-gray-900 dark:text-white placeholder-gray-400 font-aleo text-lg resize-none"
            disabled={isEvaluating}
          />

          <button
            type="submit"
            disabled={isEvaluating || !answer.trim()}
            className="gradient-lingoblitz hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lingoblitz transition-all duration-200 text-lg flex justify-center items-center gap-2 shadow-md"
          >
            {isEvaluating ? (
              <>
                <LoadingSpinner className="h-5 w-5" />
                Evaluating...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Submit your answer
              </>
            )}
          </button>
        </form>
      ) : (
        // FEEDBACK VIEW
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Feedback</h2>
            {renderAudioControls()}
          </div>
          <div className="p-6 bg-gray-50 dark:bg-gray-700/50 rounded-lingoblitz border border-gray-200 dark:border-gray-600">
            <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-aleo text-lg leading-relaxed">
              <SpeakableText
                segments={feedbackSegments}
                language={language}
                activeSegmentId={playback.activeSegmentId}
                onWordClick={onWordClick ? handleWordClick : undefined}
              />
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {showPracticeButton && (
              <button
                onClick={onPracticeVocabulary}
                className={practiceButtonClass}
              >
                Practice Vocabulary
              </button>
            )}
            <button
              onClick={onContinue}
              className={nextBlitzButtonClass}
            >
              Next Blitz
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Quiz;
