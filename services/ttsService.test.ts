import { describe, expect, it, vi } from 'vitest';

import { Language, type TTSSettings } from '../types';
import type {
  PlaybackRequest,
  PlaybackSnapshot,
} from './tts/playbackController';
import type { SpeechSegment, TTSVoiceOption } from './tts/types';
import { createTTSService } from './ttsService';

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
  let snapshot: PlaybackSnapshot = { status: 'idle', activeSegmentId: null, source: null, ownerId: null };
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

describe('provider-neutral TTS facade', () => {
  it('segments speakText input and sends only provider-neutral playback fields', async () => {
    const controller = makeController();
    const createSegments = vi.fn(() => [segment]);
    const onFallback = vi.fn();
    const service = createTTSService({
      browserVoices: vi.fn(async () => []),
      controller,
      createSegments,
      voxtralVoices: vi.fn(async () => []),
    });

    await service.speakText({
      text: 'Hallo.',
      idPrefix: 'preview',
      ownerId: 'voice-preview',
      language: Language.German,
      settings,
      onFallback,
    });

    expect(createSegments).toHaveBeenCalledExactlyOnceWith('Hallo.', Language.German, 'preview');
    expect(controller.play).toHaveBeenCalledExactlyOnceWith({
      segments: [segment],
      ownerId: 'voice-preview',
      language: Language.German,
      settings,
      onFallback,
    });
  });

  it('delegates prepared segments, controls, snapshots, and subscriptions', async () => {
    const controller = makeController();
    const service = createTTSService({
      browserVoices: vi.fn(async () => []),
      controller,
      createSegments: vi.fn(() => []),
      voxtralVoices: vi.fn(async () => []),
    });
    const request: PlaybackRequest = {
      ownerId: 'preview',
      segments: [segment],
      language: Language.German,
      settings,
    };
    const listener = vi.fn();

    await service.speakSegments(request);
    const unsubscribe = service.subscribeToPlayback(listener);
    controller.setSnapshot({
      status: 'playing',
      activeSegmentId: 'preview-0',
      source: 'voxtral',
      ownerId: 'preview',
    });
    service.pauseSpeech();
    service.resumeSpeech();
    service.stopSpeech();

    expect(controller.play).toHaveBeenCalledExactlyOnceWith(request);
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      status: 'playing',
      activeSegmentId: 'preview-0',
      source: 'voxtral',
      ownerId: 'preview',
    });
    expect(service.getPlaybackSnapshot()).toEqual({
      status: 'playing',
      activeSegmentId: 'preview-0',
      source: 'voxtral',
      ownerId: 'preview',
    });
    expect(controller.pause).toHaveBeenCalledTimes(1);
    expect(controller.resume).toHaveBeenCalledTimes(1);
    expect(controller.stop).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.setSnapshot({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
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
      voxtralVoices,
    });

    await expect(service.getVoicesForLanguage(Language.German, 'browser')).resolves.toEqual([browserVoice]);
    await expect(service.getVoicesForLanguage(Language.German, 'voxtral')).resolves.toEqual([voxtralVoice]);
    expect(browserVoices).toHaveBeenCalledTimes(1);
    expect(browserVoices).toHaveBeenNthCalledWith(1, Language.German);
    expect(voxtralVoices).toHaveBeenCalledExactlyOnceWith(Language.German, undefined);
  });

  it('exposes browser voice changes without assigning a global handler from UI code', () => {
    const subscribeToBrowserVoices = vi.fn(() => () => undefined);
    const service = createTTSService({
      browserVoices: vi.fn(async () => []),
      controller: makeController(),
      createSegments: vi.fn(() => []),
      subscribeToBrowserVoices,
      voxtralVoices: vi.fn(async () => []),
    });
    const listener = vi.fn();

    const unsubscribe = service.subscribeToVoiceChanges(listener);

    expect(subscribeToBrowserVoices).toHaveBeenCalledExactlyOnceWith(listener);
    expect(unsubscribe).toEqual(expect.any(Function));
  });
});
