import { describe, expect, it, vi } from 'vitest';

import { Language } from '../../types';
import { BrowserSpeechAdapter } from './browserAdapter';
import { TTSAdapterError, type AdapterContext, type SpeechSegment } from './types';

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

    utterance.onend?.();
    await expect(playback).resolves.toBeUndefined();
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
});
