import { describe, expect, it, vi } from 'vitest';

import { Language } from '../../types';
import { BrowserSpeechAdapter } from './browserAdapter';
import { TTSAdapterError, type AdapterContext, type PlaybackUnit, type SpeechSegment } from './types';

const segment: SpeechSegment = {
  id: 'segment-1',
  displayText: 'Hallo Welt.',
  spokenText: 'Hallo Welt.',
  visibleSentenceId: 'sentence-1',
};

const context: AdapterContext = {
  language: Language.German,
  voiceId: 'Microsoft Katja',
  speed: 0.8,
  modelMarker: 'browser',
};

class FakeUtterance {
  lang = '';
  onboundary: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onstart: (() => void) | null = null;
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;

  constructor(readonly text: string) {}
}

const makeVoice = (name: string, lang: string, localService: boolean): SpeechSynthesisVoice => ({
  default: false,
  lang,
  localService,
  name,
  voiceURI: name,
});

const createHarness = (voices: SpeechSynthesisVoice[] = [makeVoice('Microsoft Katja', 'de-DE', true)]) => {
  const utterances: FakeUtterance[] = [];
  const synthesis = {
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
    pause: vi.fn(),
    resume: vi.fn(),
    speak: vi.fn(),
  };
  const adapter = new BrowserSpeechAdapter({
    speechSynthesis: synthesis,
    createUtterance: (text) => {
      const utterance = new FakeUtterance(text);
      utterances.push(utterance);
      return utterance as unknown as SpeechSynthesisUtterance;
    },
  });

  return { adapter, synthesis, utterances };
};

describe('BrowserSpeechAdapter', () => {
  it('owns a non-destructive voiceschanged subscription for multiple UI consumers', () => {
    const eventHandlers = new Set<EventListenerOrEventListenerObject>();
    const synthesis = {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      pause: vi.fn(),
      resume: vi.fn(),
      speak: vi.fn(),
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        eventHandlers.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        eventHandlers.delete(listener);
      }),
    };
    const adapter = new BrowserSpeechAdapter({ speechSynthesis: synthesis });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = adapter.subscribeToVoiceChanges(first);
    const unsubscribeSecond = adapter.subscribeToVoiceChanges(second);
    eventHandlers.forEach((handler) => {
      if (typeof handler === 'function') handler(new Event('voiceschanged'));
      else handler.handleEvent(new Event('voiceschanged'));
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
    expect(synthesis.removeEventListener).toHaveBeenCalledTimes(2);
    expect(eventHandlers).toHaveLength(0);
  });

  it('uses the selected voice, language locale, and playback rate until sentence end', async () => {
    const { adapter, synthesis, utterances } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);

    const playback = unit.play();
    const utterance = utterances[0];

    expect(utterance.text).toBe('Hallo Welt.');
    expect(utterance.voice?.name).toBe('Microsoft Katja');
    expect(utterance.lang).toBe('de-DE');
    expect(utterance.rate).toBe(0.8);
    expect(utterance.onboundary).toBeNull();
    expect(synthesis.speak).toHaveBeenCalledWith(utterance);

    let settled = false;
    void playback.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    utterance.onstart?.();
    utterance.onend?.();
    await expect(playback).resolves.toBeUndefined();
  });

  it('reports start only when speech synthesis fires onstart', async () => {
    const { adapter, utterances } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);
    const started = (unit as PlaybackUnit & { started: Promise<void> }).started;
    let didStart = false;
    void started?.then(() => { didStart = true; });

    const playback = unit.play();
    await Promise.resolve();
    expect(started).toBeInstanceOf(Promise);
    expect(didStart).toBe(false);

    utterances[0].onstart?.();
    await expect(started).resolves.toBeUndefined();
    utterances[0].onend?.();
    await playback;
  });

  it('rejects a real synthesis error with a provider-safe adapter error', async () => {
    const { adapter, utterances } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);

    const playback = unit.play();
    utterances[0].onerror?.({ error: 'network' });

    await expect(playback).rejects.toMatchObject({
      category: 'upstream',
      message: 'Browser speech playback failed',
    } satisfies Partial<TTSAdapterError>);
  });

  it('silently stops and settles playback when cancelled', async () => {
    const controller = new AbortController();
    const { adapter, synthesis } = createHarness();
    const unit = await adapter.prepare(segment, context, controller.signal);
    const playback = unit.play();

    controller.abort();

    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    await expect(playback).resolves.toBeUndefined();
  });

  it('delegates pause, resume, and stop directly to speechSynthesis', async () => {
    const { adapter, synthesis } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);
    const playback = unit.play();

    unit.pause();
    await unit.resume();
    unit.stop();

    expect(synthesis.pause).toHaveBeenCalledTimes(1);
    expect(synthesis.resume).toHaveBeenCalledTimes(1);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    await expect(playback).resolves.toBeUndefined();
  });

  it('filters by language and preserves Microsoft, Google, Natural, then other ordering', async () => {
    const voices = [
      makeVoice('Plain local', 'de-DE', true),
      makeVoice('Cloud Natural', 'de-AT', false),
      makeVoice('Google Deutsch', 'de-DE', true),
      makeVoice('Microsoft Katja', 'de-DE', true),
      makeVoice('English Microsoft', 'en-US', true),
    ];
    const { adapter } = createHarness(voices);

    await expect(adapter.getVoices(Language.German)).resolves.toEqual([
      { id: 'Microsoft Katja', name: 'Microsoft Katja', displayName: 'Microsoft Katja (de-DE)', provider: 'browser', languages: ['de-DE'] },
      { id: 'Google Deutsch', name: 'Google Deutsch', displayName: 'Google Deutsch (de-DE)', provider: 'browser', languages: ['de-DE'] },
      { id: 'Cloud Natural', name: 'Cloud Natural', displayName: 'Cloud Natural (de-AT)', provider: 'browser', languages: ['de-AT'] },
      { id: 'Plain local', name: 'Plain local', displayName: 'Plain local (de-DE)', provider: 'browser', languages: ['de-DE'] },
    ]);
  });

  it('retains Natural and cloud as secondary preferences within vendor groups', async () => {
    const voices = [
      makeVoice('Microsoft Alpha', 'de-DE', true),
      makeVoice('Microsoft Zulu Natural', 'de-DE', false),
      makeVoice('Google Alpha', 'de-DE', true),
      makeVoice('Google Zulu Natural', 'de-DE', false),
    ];
    const { adapter } = createHarness(voices);

    const names = (await adapter.getVoices(Language.German)).map(({ name }) => name);

    expect(names).toEqual([
      'Microsoft Zulu Natural',
      'Microsoft Alpha',
      'Google Zulu Natural',
      'Google Alpha',
    ]);
  });
});
