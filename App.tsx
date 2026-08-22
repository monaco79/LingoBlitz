import React, { useState, useEffect, useCallback } from 'react';
import {
  AppState,
  Language,
  Level,
  Topic,
  type TranslationPopup,
  type UserSettings,
  type VocabularyItem,
} from './types';
import Onboarding from './components/Onboarding';
import SettingsModal from './components/SettingsModal';
import Article from './components/Article';
import TopicSelector from './components/TopicSelector';
import LoadingSpinner from './components/icons/LoadingSpinner';
import SettingsIcon from './components/icons/SettingsIcon';
import InfoIcon from './components/icons/InfoIcon';
import CloseIcon from './components/icons/CloseIcon';
import InfoModal from './components/InfoModal';
import SunIcon from './components/icons/SunIcon';
import MoonIcon from './components/icons/MoonIcon';
import PostArticleActions from './components/PostArticleActions';
import Quiz from './components/Quiz';
import VocabularyPractice from './components/VocabularyPractice';
import TTSFallbackNotice from './components/TTSFallbackNotice';
import * as aiService from './services/aiService';
import { migrateTTSSettings } from './services/tts/settings';
import * as ttsService from './services/ttsService';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEnumValue = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

const readSavedSettings = (serialized: string | null): UserSettings | null => {
  if (!serialized) return null;

  try {
    const raw: unknown = JSON.parse(serialized);
    if (
      !isRecord(raw)
      || !isEnumValue(Object.values(Language), raw.nativeLanguage)
      || !isEnumValue(Object.values(Language), raw.learningLanguage)
      || !isEnumValue(Object.values(Level), raw.level)
      || !Array.isArray(raw.interests)
      || !raw.interests.every((interest) => isEnumValue(Object.values(Topic), interest))
      || (raw.blitzedTopics !== undefined
        && (!Array.isArray(raw.blitzedTopics)
          || !raw.blitzedTopics.every((topic) => typeof topic === 'string')))
    ) {
      return null;
    }

    return {
      nativeLanguage: raw.nativeLanguage,
      learningLanguage: raw.learningLanguage,
      level: raw.level,
      interests: raw.interests,
      blitzedTopics: Array.isArray(raw.blitzedTopics)
        ? raw.blitzedTopics.filter((topic): topic is string => typeof topic === 'string')
        : [],
      tts: migrateTTSSettings(raw.tts, raw.learningLanguage),
    };
  } catch {
    return null;
  }
};

const App: React.FC = () => {
  // DEVELOPMENT: Expose aiService to window for console testing
  if (typeof window !== 'undefined') {
    (window as any).aiService = aiService;
  }

  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [appState, setAppState] = useState<AppState>(AppState.ONBOARDING);
  const [topicProposals, setTopicProposals] = useState<string[]>([]);
  const [articleTitle, setArticleTitle] = useState<string>('');
  const [articleContent, setArticleContent] = useState<string>('');
  const [translationPopup, setTranslationPopup] = useState<TranslationPopup | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [skippedProposalHistory, setSkippedProposalHistory] = useState<string | null>(null);
  const [quizQuestion, setQuizQuestion] = useState<string | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [isQuizReady, setIsQuizReady] = useState(false);
  const [areProposalsReady, setAreProposalsReady] = useState(false);
  const [currentVocabulary, setCurrentVocabulary] = useState<VocabularyItem[]>([]);
  const [hasCompletedQuiz, setHasCompletedQuiz] = useState(false);
  const [hasCompletedVocabulary, setHasCompletedVocabulary] = useState(false);
  const [ttsFallbackTrigger, setTTSFallbackTrigger] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('lingoBlitzTheme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('lingoBlitzTheme', theme);
  }, [theme]);

  useEffect(() => {
    const settings = readSavedSettings(localStorage.getItem('lingoBlitzSettings'));
    if (settings) {
      setUserSettings(settings);
      setAppState(AppState.GENERATING_PROPOSALS);
    }
  }, []);

  useEffect(() => {
    ttsService.stopSpeech();
  }, [appState]);

  const handleTTSFallback = useCallback(() => {
    setTTSFallbackTrigger((current) => current + 1);
  }, []);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const handleOnboardingComplete = (settings: UserSettings) => {
    const completeSettings = { ...settings, blitzedTopics: [] };
    localStorage.setItem('lingoBlitzSettings', JSON.stringify(completeSettings));
    setUserSettings(completeSettings);
    setAppState(AppState.GENERATING_PROPOSALS);
  };

  const handleSaveSettings = (settings: UserSettings) => {
    const completeSettings = { ...settings, blitzedTopics: userSettings?.blitzedTopics || [] };
    localStorage.setItem('lingoBlitzSettings', JSON.stringify(completeSettings));
    setUserSettings(completeSettings);
    setIsSettingsOpen(false);
    setArticleContent('');
    setArticleTitle('');
    setAppState(AppState.GENERATING_PROPOSALS);
  };

  const fetchInitialProposals = useCallback(async () => {
    if (userSettings) {
      setTopicProposals([]);
      setSkippedProposalHistory(null);
      const proposals = await aiService.generateTopicProposals(
        userSettings.interests,
        userSettings.blitzedTopics,
        2,
        userSettings.learningLanguage,
        userSettings.level
      );
      setTopicProposals(proposals);
      setAppState(AppState.READY);
    }
  }, [userSettings]);

  const fetchNextProposals = useCallback(async (blitzedTopic: string, previousProposals: string[]) => {
    if (!userSettings) return;

    const currentSkippedProposal = previousProposals.find(p => p !== blitzedTopic) || null;

    const topicsToAvoid = [...userSettings.blitzedTopics, blitzedTopic];
    let proposalsToKeep: string[] = [];

    if (currentSkippedProposal && currentSkippedProposal !== skippedProposalHistory) {
      proposalsToKeep.push(currentSkippedProposal);
      topicsToAvoid.push(currentSkippedProposal);
    }

    const numToGenerate = 2 - proposalsToKeep.length;
    const newGeneratedProposals = numToGenerate > 0
      ? await aiService.generateTopicProposals(
        userSettings.interests,
        topicsToAvoid,
        numToGenerate,
        userSettings.learningLanguage,
        userSettings.level
      )
      : [];

    const finalProposals = [...proposalsToKeep, ...newGeneratedProposals];
    setTopicProposals(finalProposals.sort(() => Math.random() - 0.5));
    setSkippedProposalHistory(currentSkippedProposal);
  }, [userSettings, skippedProposalHistory]);


  useEffect(() => {
    if (appState === AppState.GENERATING_PROPOSALS) {
      fetchInitialProposals();
    }
  }, [appState, fetchInitialProposals]);

  const handleBlitz = async (topic: string) => {
    if (!userSettings) return;
    const userClickTime = performance.now();
    console.log('🏁 [PERF-UI] User clicked "Let\'s Blitz!" button');

    setAppState(AppState.GENERATING_ARTICLE);
    setTranslationPopup(null);
    setArticleTitle('');
    setArticleContent('');
    setQuizQuestion(null);
    setQuizFeedback(null);
    setIsQuizReady(false);
    setAreProposalsReady(false);
    setCurrentVocabulary([]);
    setHasCompletedQuiz(false);
    setHasCompletedVocabulary(false);
    const currentProposals = [...topicProposals];
    setTopicProposals([]);

    try {
      const streamCallStart = performance.now();
      const stream = await aiService.generateArticleStream(topic, userSettings);
      const streamReceivedTime = performance.now();

      let accumulatedText = '';
      let titleFound = false;
      let finalContent = '';
      let firstChunkReceived = false;

      for await (const chunk of stream) {
        if (!firstChunkReceived) {
          const firstChunkTime = performance.now();
          firstChunkReceived = true;
        }

        const content = chunk.choices[0]?.delta?.content || "";
        if (!content) continue;
        accumulatedText += content;
        if (!titleFound && accumulatedText.includes('\n')) {
          const parts = accumulatedText.split('\n');
          const title = parts[0].trim();
          finalContent = parts.slice(1).join('\n');
          setArticleTitle(title);
          setArticleContent(finalContent);
          titleFound = true;
        } else if (titleFound) {
          finalContent += content;
          setArticleContent(prev => prev + content);
        }
      }

      if (!titleFound && accumulatedText.length > 0) {
        const parts = accumulatedText.split('\n');
        const title = parts[0].trim();
        finalContent = parts.slice(1).join('\n');
        setArticleTitle(title);
        setArticleContent(finalContent);
      }

      const updatedBlitzedTopics = [...userSettings.blitzedTopics, topic];
      const updatedSettings = { ...userSettings, blitzedTopics: updatedBlitzedTopics };
      setUserSettings(updatedSettings);
      localStorage.setItem('lingoBlitzSettings', JSON.stringify(updatedSettings));

      setAppState(AppState.POST_ARTICLE_CHOICE);

      aiService.generateQuizQuestion(finalContent, userSettings.learningLanguage, userSettings.level)
        .then(question => {
          setQuizQuestion(question);
          setIsQuizReady(true);
        });

      fetchNextProposals(topic, currentProposals)
        .then(() => {
          setAreProposalsReady(true);
        });

    } catch (error) {
      console.error("❌ [PERF-UI] Error during Blitz generation:", error);
      setArticleTitle("Error");
      setArticleContent("There was an error generating the article. Please try again.");
      setAppState(AppState.POST_ARTICLE_CHOICE);
      setAreProposalsReady(true);
    }
  };

  // HELPER: Play word audio
  const playWordAudio = (word: string) => {
    if (userSettings?.tts) {
      void ttsService.speakText({
        text: word,
        idPrefix: 'word',
        language: userSettings.learningLanguage,
        settings: userSettings.tts,
        onFallback: handleTTSFallback,
      }).catch((error: unknown) => {
        console.error('TTS playback failed', error);
      });
    }
  };

  const handleWordClick = async (word: string, event: React.MouseEvent<HTMLSpanElement>) => {
    if (!userSettings) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const popupTop = window.scrollY + rect.top - 85;
    const popupLeft = window.scrollX + rect.left + rect.width / 2;

    setTranslationPopup({ word, translation: '...', position: { top: popupTop, left: popupLeft } });

    // 1. Stop any existing main audio (handled by Article/Quiz click, but reinforcing here)
    ttsService.stopSpeech();

    // 2. Play the word immediately ONLY if auto-read is enabled
    if (userSettings.tts.autoRead) {
      playWordAudio(word);
    }

    // 3. Fetch Translation
    const translation = await aiService.translateWord(word, userSettings.learningLanguage, userSettings.nativeLanguage);

    setTranslationPopup(current =>
      (current && current.word === word)
        ? { ...current, translation }
        : current
    );

    if (translation &&
      !translation.toLowerCase().includes('translation failed') &&
      !translation.toLowerCase().includes('translation unavailable')) {
      setCurrentVocabulary(prevVocab => {
        if (!prevVocab.some(v => v.word === word)) {
          return [...prevVocab, { word, translation }];
        }
        return prevVocab;
      });
    }
  };

  const handleTakeQuiz = () => {
    setAppState(AppState.SHOWING_QUIZ);
  };

  const handleNewBlitz = () => {
    setArticleTitle('');
    setArticleContent('');
    setAppState(AppState.READY);
  };

  const handlePracticeVocabulary = () => {
    setAppState(AppState.PRACTICING_VOCABULARY);
  };

  const handleAnswerSubmit = async (answer: string) => {
    if (!userSettings || !quizQuestion || !articleContent) return;

    setAppState(AppState.EVALUATING_QUIZ);
    const feedback = await aiService.evaluateQuizAnswer(
      articleContent,
      quizQuestion,
      answer,
      userSettings.learningLanguage,
      userSettings.level
    );
    setQuizFeedback(feedback);
    setAppState(AppState.SHOWING_QUIZ_FEEDBACK);
    setHasCompletedQuiz(true);
  };

  const handleQuizComplete = () => {
    setHasCompletedQuiz(true);
    setAppState(AppState.POST_ARTICLE_CHOICE);
  };

  const handleVocabularyComplete = () => {
    setHasCompletedVocabulary(true);
    if (hasCompletedQuiz) {
      handleContinueToNextBlitz();
    } else {
      setAppState(AppState.POST_ARTICLE_CHOICE);
    }
  };

  const handleContinueToNextBlitz = () => {
    setArticleTitle('');
    setArticleContent('');
    setQuizQuestion(null);
    setQuizFeedback(null);
    setCurrentVocabulary([]);
    setHasCompletedQuiz(false);
    setHasCompletedVocabulary(false);
    setAppState(AppState.READY);
  };

  const renderContent = () => {
    if (!userSettings) {
      return <Onboarding onComplete={handleOnboardingComplete} />;
    }

    return (
      <div className="w-full min-h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8 space-y-8 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
        <header className="w-full max-w-4xl flex justify-between items-center py-2">
          <div className="flex items-center gap-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-gradient-lingoblitz leading-tight pb-1">LingoBlitz</h1>
            <div
              className="h-12 w-12 sm:h-14 sm:w-14 bg-[#ED918E]"
              style={{
                maskImage: 'url(/logo.png)',
                maskSize: 'contain',
                maskRepeat: 'no-repeat',
                maskPosition: 'center',
                WebkitMaskImage: 'url(/logo.png)',
                WebkitMaskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center'
              }}
            />
          </div>
          <div className="flex items-center gap-4">
            <button onClick={toggleTheme} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              {theme === 'light' ? <MoonIcon className="h-6 w-6" /> : <SunIcon className="h-6 w-6" />}
            </button>
            <button onClick={() => setShowInfoModal(true)} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              <InfoIcon className="h-7 w-7" />
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              <SettingsIcon className="h-7 w-7" />
            </button>
          </div>
        </header>

        {appState === AppState.GENERATING_ARTICLE && !articleContent && !articleTitle && (
          <div className="w-full max-w-4xl p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg flex flex-col items-center justify-center min-h-[200px] gap-4">
            <LoadingSpinner className="h-8 w-8 text-sky-500" />
            <p className="text-lg text-gray-600 dark:text-gray-400">Generating your Blitz...</p>
          </div>
        )}

        {(articleTitle || articleContent) && (
          <Article
            title={articleTitle}
            content={articleContent}
            level={userSettings.level}
            ttsSettings={userSettings.tts}
            language={userSettings.learningLanguage}
            onWordClick={handleWordClick}
            onFallback={handleTTSFallback}
          />
        )}

        {appState === AppState.POST_ARTICLE_CHOICE && (
          <PostArticleActions
            onTakeQuiz={handleTakeQuiz}
            onNewBlitz={handleContinueToNextBlitz}
            onPracticeVocabulary={handlePracticeVocabulary}
            canPracticeVocabulary={currentVocabulary.length > 0 && !hasCompletedVocabulary}
            canTakeQuiz={!hasCompletedQuiz}
            isQuizReady={isQuizReady}
            areProposalsReady={areProposalsReady}
            hasCompletedQuiz={hasCompletedQuiz}
            hasCompletedVocabulary={hasCompletedVocabulary}
          />
        )}

        {(appState === AppState.SHOWING_QUIZ || appState === AppState.EVALUATING_QUIZ || appState === AppState.SHOWING_QUIZ_FEEDBACK) && quizQuestion && (
          <Quiz
            question={quizQuestion}
            onAnswerSubmit={handleAnswerSubmit}
            isEvaluating={appState === AppState.EVALUATING_QUIZ}
            feedback={quizFeedback}
            onContinue={handleContinueToNextBlitz}
            onWordClick={handleWordClick}
            ttsSettings={userSettings.tts}
            onFallback={handleTTSFallback}
            language={userSettings.learningLanguage}
            hasVocabulary={currentVocabulary.length > 0}
            onPracticeVocabulary={handlePracticeVocabulary}
            hasCompletedVocabulary={hasCompletedVocabulary}
          />
        )}

        {appState === AppState.PRACTICING_VOCABULARY && (
          <VocabularyPractice
            vocabulary={currentVocabulary}
            onComplete={handleVocabularyComplete}
            learningLanguage={userSettings!.learningLanguage}
            ttsSettings={userSettings.tts}
            onFallback={handleTTSFallback}
          />
        )}

        {appState === AppState.GENERATING_PROPOSALS && (
          <div className="w-full max-w-4xl p-8 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg flex flex-col items-center justify-center min-h-[200px] gap-4">
            <LoadingSpinner className="h-8 w-8 text-sky-500" />
            <p className="text-lg text-gray-600 dark:text-gray-400">Generating new topic ideas...</p>
          </div>
        )}

        {topicProposals.length > 0 && appState === AppState.READY && (
          <TopicSelector
            proposals={topicProposals}
            onBlitz={handleBlitz}
            onNewProposals={() => {
              setTopicProposals([]);
              setAppState(AppState.GENERATING_PROPOSALS);
            }}
            isBlitzing={false}
            onWordClick={handleWordClick}
            language={userSettings.learningLanguage}
          />
        )}
      </div>
    );
  };

  return (
    <main>
      {renderContent()}
      <TTSFallbackNotice trigger={ttsFallbackTrigger} />
      {isSettingsOpen && userSettings && (
        <SettingsModal currentSettings={userSettings} onSave={handleSaveSettings} onClose={() => setIsSettingsOpen(false)} />
      )}
      {showInfoModal && (
        <InfoModal onClose={() => setShowInfoModal(false)} />
      )}
      {translationPopup && (
        <div
          className="absolute z-50 transform -translate-x-1/2 pointer-events-none"
          style={{
            top: `${translationPopup.position.top}px`,
            left: `${translationPopup.position.left}px`,
          }}
        >
          <div
            className="relative bg-white dark:bg-gray-800 rounded-lingoblitz shadow-2xl p-4 text-center cursor-pointer pointer-events-auto border-2 border-gray-200 dark:border-gray-600"
            style={{ minWidth: '160px', maxWidth: '250px' }}
            onClick={(e) => {
              e.stopPropagation();
              setTranslationPopup(null);
            }}
          >
            {/* Close button with gradient */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTranslationPopup(null);
              }}
              className="absolute -top-2 -right-2 gradient-lingoblitz rounded-full p-1.5 shadow-md hover:opacity-90 transition-opacity"
            >
              <CloseIcon className="h-4 w-4 text-white" />
            </button>

            {/* Original word with Speaker Button */}
            <div className="flex items-center justify-center gap-2 mb-2">
              <p className="font-semibold text-gradient-lingoblitz text-base uppercase tracking-wide">{translationPopup.word}</p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  playWordAudio(translationPopup.word);
                }}
                className="text-gray-400 hover:text-purple-500 transition-colors"
                title="Play pronunciation"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>

            {/* Translation */}
            <p className="text-2xl font-aleo font-medium text-gray-900 dark:text-white">{translationPopup.translation}</p>

            {/* Arrow pointing down */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: '-10px' }}>
              <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-gray-200 dark:border-t-gray-600"></div>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: '-8px' }}>
              <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-white dark:border-t-gray-800"></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default App;
