import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  isActiveSurface: boolean;
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
  isActiveSurface,
}) => {
  const [answer, setAnswer] = useState('');
  const [playback, setPlayback] = useState<PlaybackSnapshot>(() => ttsService.getPlaybackSnapshot());
  const autoReadTimerRef = useRef<number | null>(null);
  const autoReadTriggeredRef = useRef(false);
  const questionSegments = useMemo(
    () => createSpeechSegments(question, language, 'quiz-question'),
    [language, question],
  );
  const feedbackSegments = useMemo(
    () => feedback
      ? createSpeechSegments(feedback, language, 'quiz-feedback')
      : [],
    [feedback, language],
  );
  const currentSegments = feedback ? feedbackSegments : questionSegments;

  useEffect(() => ttsService.subscribeToPlayback(setPlayback), []);

  useEffect(() => () => {
    ttsService.stopSpeech();
  }, [feedback, language, question]);

  const cancelPendingAutoRead = useCallback((markTriggered = true) => {
    if (autoReadTimerRef.current !== null) {
      window.clearTimeout(autoReadTimerRef.current);
      autoReadTimerRef.current = null;
    }
    if (markTriggered) autoReadTriggeredRef.current = true;
  }, []);

  useEffect(() => {
    cancelPendingAutoRead(false);
    autoReadTriggeredRef.current = false;
    return () => cancelPendingAutoRead(false);
  }, [cancelPendingAutoRead, feedback, language, question]);

  const playSegments = useCallback(() => {
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

  const handlePlay = useCallback(() => {
    cancelPendingAutoRead();
    playSegments();
  }, [cancelPendingAutoRead, playSegments]);

  useEffect(() => {
    cancelPendingAutoRead(false);
    if (!isActiveSurface) {
      cancelPendingAutoRead();
      return undefined;
    }
    if (!ttsSettings.autoRead || currentSegments.length === 0 || autoReadTriggeredRef.current) {
      return undefined;
    }

    autoReadTimerRef.current = window.setTimeout(() => {
      autoReadTimerRef.current = null;
      if (autoReadTriggeredRef.current) return;
      autoReadTriggeredRef.current = true;
      playSegments();
    }, 800);

    return () => cancelPendingAutoRead(false);
  }, [cancelPendingAutoRead, currentSegments.length, isActiveSurface, playSegments, ttsSettings.autoRead]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (answer.trim()) {
      cancelPendingAutoRead();
      ttsService.stopSpeech();
      onAnswerSubmit(answer.trim());
    }
  };

  const handleWordClick = useCallback((word: string, event: React.MouseEvent<HTMLSpanElement>) => {
    cancelPendingAutoRead();
    ttsService.stopSpeech();
    onWordClick?.(word, event);
  }, [cancelPendingAutoRead, onWordClick]);

  const handlePause = useCallback(() => {
    cancelPendingAutoRead();
    ttsService.pauseSpeech();
  }, [cancelPendingAutoRead]);

  const handleResume = useCallback(() => {
    cancelPendingAutoRead();
    ttsService.resumeSpeech();
  }, [cancelPendingAutoRead]);

  const handleStop = useCallback(() => {
    cancelPendingAutoRead();
    ttsService.stopSpeech();
  }, [cancelPendingAutoRead]);

  const leaveQuiz = useCallback((next: () => void) => {
    cancelPendingAutoRead();
    ttsService.stopSpeech();
    next();
  }, [cancelPendingAutoRead]);

  const ownedVisibleIds = useMemo(
    () => new Set(currentSegments.map(({ visibleSentenceId }) => visibleSentenceId)),
    [currentSegments],
  );
  const ownsPlayback = playback.activeSegmentId !== null && ownedVisibleIds.has(playback.activeSegmentId);
  const isPlaying = isActiveSurface && ownsPlayback && playback.status !== 'idle';
  const isPaused = isPlaying && playback.status === 'paused';

  // Render helper for audio controls
  const renderAudioControls = () => (
    <div className="flex items-center gap-2">
      {isPlaying || isPaused ? (
        <>
          <button
            type="button"
            onClick={isPaused ? handleResume : handlePause}
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
            onClick={handleStop}
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
                renderEmphasis
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
                renderEmphasis
              />
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {showPracticeButton && (
              <button
                onClick={() => leaveQuiz(onPracticeVocabulary)}
                className={practiceButtonClass}
              >
                Practice Vocabulary
              </button>
            )}
            <button
              onClick={() => leaveQuiz(onContinue)}
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
