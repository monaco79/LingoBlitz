import { describe, expect, it, vi } from 'vitest';

import { Language, type TTSSettings } from '../types';
import type {
  PlaybackRequest,
  PlaybackSnapshot,
} from './tts/playbackController';
import type { SpeechSegment, TTSVoiceOption } from './tts/types';
import {
  createLegacyBrowserSpeech,
  createTTSService,
} from './ttsService';

const settings: TTSSettings = {
  preferences: {
    [Language.German]: {
      provider: 'voxtral',
      voxtralVoiceId: 'voice-1',
      browserVoiceName: 'Anna',
    },
  },
  speed: 0.8,
  autoRead: false,
};

const segment: SpeechSegment = {
  id: 'preview-0-0',
  displayText: 'Hallo.',
  spokenText: 'Hallo.',
  visibleSentenceId: 'preview-0',
};

const makeController = () => {
  let snapshot: PlaybackSnapshot = { status: 'idle', activeSegmentId: null, source: null };
  const listeners = new Set<(next: PlaybackSnapshot) => void>();
  return {
    getSnapshot: vi.fn(() => snapshot),
    pause: vi.fn(),
    play: vi.fn(async (_request: PlaybackRequest) => undefined),
    resume: vi.fn(),
    setSnapshot(next: PlaybackSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener(next));
    },
    stop: vi.fn(),
    subscribe: vi.fn((listener: (next: PlaybackSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
};

const makeLegacy = () => ({
  getDefaultVoice: vi.fn(async () => ''),
  isSpeaking: vi.fn(() => false),
  pause: vi.fn(),
  resume: vi.fn(),
  speak: vi.fn(async () => undefined),
  stop: vi.fn(),
});

describe('provider-neutral TTS facade', () => {
  it('segments speakText input and sends only provider-neutral playback fields', async () => {
    const controller = makeController();
    const createSegments = vi.fn(() => [segment]);
    const onFallback = vi.fn();
    const service = createTTSService({
      browserVoices: vi.fn(async () => []),
      controller,
      createSegments,
      legacy: makeLegacy(),
      voxtralVoices: vi.fn(async () => []),
    });

    await service.speakText({
      text: 'Hallo.',
      idPrefix: 'preview',
      language: Language.German,
      settings,
      onFallback,
    });

    expect(createSegments).toHaveBeenCalledExactlyOnceWith('Hallo.', Language.German, 'preview');
    expect(controller.play).toHaveBeenCalledExactlyOnceWith({
      segments: [segment],
      language: Language.German,
      settings,
      onFallback,
    });
    expect('onBoundary' in controller.play.mock.calls[0][0]).toBe(false);
  });

  it('delegates prepared segments, controls, snapshots, and subscriptions', async () => {
    const controller = makeController();
    const legacy = makeLegacy();
    const service = createTTSService({
      browserVoices: vi.fn(async () => []),
      controller,
      createSegments: vi.fn(() => []),
      legacy,
      voxtralVoices: vi.fn(async () => []),
    });
    const request: PlaybackRequest = {
      segments: [segment],
      language: Language.German,
      settings,
    };
    const listener = vi.fn();

    await service.speakSegments(request);
    const unsubscribe = service.subscribeToPlayback(listener);
    controller.setSnapshot({ status: 'playing', activeSegmentId: 'preview-0', source: 'voxtral' });
    service.pauseSpeech();
    service.resumeSpeech();
    service.stopSpeech();

    expect(controller.play).toHaveBeenCalledExactlyOnceWith(request);
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      status: 'playing',
      activeSegmentId: 'preview-0',
      source: 'voxtral',
    });
    expect(service.getPlaybackSnapshot()).toEqual({
      status: 'playing',
      activeSegmentId: 'preview-0',
      source: 'voxtral',
    });
    expect(controller.pause).toHaveBeenCalledTimes(1);
    expect(controller.resume).toHaveBeenCalledTimes(1);
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(legacy.pause).toHaveBeenCalledTimes(1);
    expect(legacy.resume).toHaveBeenCalledTimes(1);
    expect(legacy.stop).toHaveBeenCalledTimes(1);

    unsubscribe();
    controller.setSnapshot({ status: 'idle', activeSegmentId: null, source: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns provider-neutral voice options from only the requested provider', async () => {
    const browserVoice: TTSVoiceOption = {
      id: 'Anna',
      name: 'Anna',
      displayName: 'Anna (de-DE)',
      provider: 'browser',
      languages: ['de-DE'],
    };
    const voxtralVoice: TTSVoiceOption = {
      id: 'voice-1',
      name: 'Voxtral Anna',
      displayName: 'Voxtral Anna',
      provider: 'voxtral',
      languages: ['de'],
    };
    const browserVoices = vi.fn(async () => [browserVoice]);
    const voxtralVoices = vi.fn(async () => [voxtralVoice]);
    const service = createTTSService({
      browserVoices,
      controller: makeController(),
      createSegments: vi.fn(() => []),
      legacy: makeLegacy(),
      voxtralVoices,
    });

    await expect(service.getVoicesForLanguage(Language.German, 'browser')).resolves.toEqual([browserVoice]);
    await expect(service.getVoicesForLanguage(Language.German, 'voxtral')).resolves.toEqual([voxtralVoice]);
    await expect(service.getVoicesForLanguage(Language.German)).resolves.toEqual([{
      ...browserVoice,
      locale: 'de-DE',
    }]);
    expect(browserVoices).toHaveBeenCalledTimes(2);
    expect(browserVoices).toHaveBeenNthCalledWith(1, Language.German);
    expect(browserVoices).toHaveBeenNthCalledWith(2, Language.German);
    expect(voxtralVoices).toHaveBeenCalledExactlyOnceWith(Language.German, undefined);
  });

  it('exposes browser voice changes without assigning a global handler from UI code', () => {
    const subscribeToBrowserVoices = vi.fn(() => () => undefined);
    const service = createTTSService({
      browserVoices: vi.fn(async () => []),
      controller: makeController(),
      createSegments: vi.fn(() => []),
      legacy: makeLegacy(),
      subscribeToBrowserVoices,
      voxtralVoices: vi.fn(async () => []),
    });
    const listener = vi.fn();

    const unsubscribe = service.subscribeToVoiceChanges(listener);

    expect(subscribeToBrowserVoices).toHaveBeenCalledExactlyOnceWith(listener);
    expect(unsubscribe).toEqual(expect.any(Function));
  });
});

describe('deprecated positional browser wrapper', () => {
  it('retains character-boundary and playback-end callbacks until call sites migrate', async () => {
    const voice = { name: 'Anna', lang: 'de-DE' } as SpeechSynthesisVoice;
    const utterances: SpeechSynthesisUtterance[] = [];
    const synthesis = {
      cancel: vi.fn(),
      get paused() { return false; },
      get speaking() { return true; },
      getVoices: vi.fn(() => [voice]),
      pause: vi.fn(),
      resume: vi.fn(),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterances.push(utterance)),
    };
    const legacy = createLegacyBrowserSpeech({
      createUtterance: (text) => ({ text } as SpeechSynthesisUtterance),
      speechSynthesis: synthesis,
    });
    const onBoundary = vi.fn();
    const onPlaybackEnd = vi.fn();

    const playback = legacy.speak(
      'Hallo.',
      'Anna',
      0.8,
      Language.German,
      onPlaybackEnd,
      onBoundary,
    );
    await vi.waitFor(() => expect(utterances).toHaveLength(1));

    utterances[0].onboundary?.({ charIndex: 3 } as SpeechSynthesisEvent);
    expect(onBoundary).toHaveBeenCalledExactlyOnceWith(3);
    utterances[0].onend?.(new Event('end') as SpeechSynthesisEvent);

    await expect(playback).resolves.toBeUndefined();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
  });
});
