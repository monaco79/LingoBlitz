import { describe, expect, it, vi } from 'vitest';

import { Language } from '../../types';
import { AudioCache } from './audioCache';
import { TTSAdapterError, type AdapterContext, type PlaybackUnit, type SpeechSegment } from './types';
import { createVoxtralCacheKey, VoxtralSpeechAdapter } from './voxtralAdapter';

const segment: SpeechSegment = {
  id: 'segment-1',
  displayText: 'Hallo Welt.',
  spokenText: '  Hallo   Welt.  ',
  visibleSentenceId: 'sentence-1',
};

const context: AdapterContext = {
  language: Language.German,
  voiceId: 'voice-1',
  speed: 0.8,
  modelMarker: 'voxtral-mini-tts-2603',
};

class FakeAudio extends EventTarget {
  currentTime = 0;
  pause = vi.fn();
  playbackRate = 1;
  play = vi.fn(async () => undefined);
  src = '';
}

const createHarness = (overrides: {
  fetchAudio?: (
    segment: SpeechSegment,
    language: Language,
    voiceId: string,
    signal?: AbortSignal,
  ) => Promise<Blob | { blob: Blob; modelMarker: string }>;
  maxBytes?: number;
  maxEntries?: number;
} = {}) => {
  let nextUrl = 0;
  const createObjectURL = vi.fn(() => `blob:voxtral-${++nextUrl}`);
  const revokeObjectURL = vi.fn();
  const cache = new AudioCache({
    maxEntries: overrides.maxEntries ?? 4,
    maxBytes: overrides.maxBytes ?? 100,
    createObjectURL,
    revokeObjectURL,
  });
  const fetchAudio = overrides.fetchAudio ?? vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }));
  const audios: FakeAudio[] = [];
  const adapter = new VoxtralSpeechAdapter({
    cache,
    fetchAudio,
    createAudio: () => {
      const audio = new FakeAudio();
      audios.push(audio);
      return audio as unknown as HTMLAudioElement;
    },
    createObjectURL,
    revokeObjectURL,
  });

  return { adapter, audios, cache, createObjectURL, fetchAudio, revokeObjectURL };
};

describe('VoxtralSpeechAdapter', () => {
  it('coalesces simultaneous identical cache misses into one synthesis', async () => {
    let resolveAudio!: (blob: Blob) => void;
    const fetchAudio = vi.fn(() => new Promise<Blob>((resolve) => {
      resolveAudio = resolve;
    }));
    const { adapter, audios } = createHarness({ fetchAudio });

    const firstPreparation = adapter.prepare(segment, context, new AbortController().signal);
    const secondPreparation = adapter.prepare(
      { ...segment, spokenText: 'Hallo Welt.' },
      { ...context, speed: 1.2 },
      new AbortController().signal,
    );
    expect(fetchAudio).toHaveBeenCalledTimes(1);

    resolveAudio(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }));
    const [first, second] = await Promise.all([firstPreparation, secondPreparation]);
    expect(audios).toHaveLength(2);
    expect(audios[0].src).toBe(audios[1].src);
    first.dispose();
    second.dispose();
  });

  it('pins prepared and playing cache URLs through eviction and revokes after final dispose', async () => {
    const { adapter, audios, cache, revokeObjectURL } = createHarness({ maxEntries: 1 });
    const first = await adapter.prepare(segment, context, new AbortController().signal);
    const firstUrl = audios[0].src;
    const playback = first.play();
    audios[0].dispatchEvent(new Event('playing'));

    const second = await adapter.prepare(
      { ...segment, id: 'segment-2', spokenText: 'Anderer Satz.' },
      context,
      new AbortController().signal,
    );
    const secondUrl = audios[1].src;
    expect(revokeObjectURL).not.toHaveBeenCalledWith(firstUrl);

    cache.clear();
    expect(revokeObjectURL).not.toHaveBeenCalledWith(secondUrl);
    first.stop();
    first.dispose();
    await playback;
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(firstUrl);

    second.dispose();
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === secondUrl)).toHaveLength(1);
  });

  it('keeps rapid replacement synthesis at three active requests until aborted work settles', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchAudio = vi.fn((_segment, _language, _voiceId, signal: AbortSignal) => (
      new Promise<Blob>((_resolve, reject) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        signal.addEventListener('abort', () => {
          queueMicrotask(() => {
            active -= 1;
            reject(new TTSAdapterError('cancelled', 'cancelled'));
          });
        }, { once: true });
      })
    ));
    const { adapter } = createHarness({ fetchAudio });
    const firstControllers = Array.from({ length: 3 }, () => new AbortController());
    const first = firstControllers.map((controller, index) => adapter.prepare(
      { ...segment, id: `old-${index}`, spokenText: `Old ${index}.` },
      context,
      controller.signal,
    ).catch(() => undefined));
    expect(fetchAudio).toHaveBeenCalledTimes(3);

    firstControllers.forEach((controller) => controller.abort());
    const replacementControllers = Array.from({ length: 3 }, () => new AbortController());
    const replacements = replacementControllers.map((controller, index) => adapter.prepare(
      { ...segment, id: `new-${index}`, spokenText: `New ${index}.` },
      context,
      controller.signal,
    ).catch(() => undefined));

    expect(maxActive).toBeLessThanOrEqual(3);
    await Promise.resolve();
    await vi.waitFor(() => expect(fetchAudio).toHaveBeenCalledTimes(6));
    replacementControllers.forEach((controller) => controller.abort());
    await Promise.all([...first, ...replacements]);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('reuses cached normalized audio across playback speeds', async () => {
    const { adapter, fetchAudio } = createHarness();

    await adapter.prepare(segment, context, new AbortController().signal);
    await adapter.prepare(
      { ...segment, spokenText: 'Hallo Welt.' },
      { ...context, speed: 1.2 },
      new AbortController().signal,
    );

    expect(fetchAudio).toHaveBeenCalledTimes(1);
  });

  it('keeps language, model marker, and voice ID in the cache key', async () => {
    const { adapter, fetchAudio } = createHarness();

    await adapter.prepare(segment, context, new AbortController().signal);
    await adapter.prepare(segment, { ...context, language: Language.French }, new AbortController().signal);
    await adapter.prepare(segment, { ...context, modelMarker: 'new-model' }, new AbortController().signal);
    await adapter.prepare(segment, { ...context, voiceId: 'voice-2' }, new AbortController().signal);

    expect(fetchAudio).toHaveBeenCalledTimes(4);
  });

  it('stores generated audio under the server-configured model namespace', async () => {
    const serverModel = 'configured-server-model';
    const fetchAudio = vi.fn(async () => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      modelMarker: serverModel,
    }));
    const { adapter, cache } = createHarness({ fetchAudio });

    const first = await adapter.prepare(segment, context, new AbortController().signal);
    first.dispose();
    const second = await adapter.prepare(
      segment,
      { ...context, modelMarker: 'stale-client-default' },
      new AbortController().signal,
    );

    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(cache.get(createVoxtralCacheKey(segment, { ...context, modelMarker: serverModel }))).toBeDefined();
    expect(cache.get(createVoxtralCacheKey(segment, context))).toBeUndefined();
    second.dispose();
  });

  it('does not request audio for a silent display segment', async () => {
    const { adapter, fetchAudio } = createHarness();
    const unit = await adapter.prepare({ ...segment, spokenText: '' }, context, new AbortController().signal);

    await expect(unit.play()).resolves.toBeUndefined();
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('creates audio with the Blob URL and rate and resolves on ended', async () => {
    const { adapter, audios } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);

    const playback = unit.play();
    const audio = audios[0];

    expect(audio.src).toBe('blob:voxtral-1');
    expect(audio.playbackRate).toBe(0.8);
    expect(audio.play).toHaveBeenCalledTimes(1);

    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('ended'));
    await expect(playback).resolves.toBeUndefined();
  });

  it('reports start only after the media playing event, not play promise fulfillment', async () => {
    const { adapter, audios } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);
    const started = (unit as PlaybackUnit & { started: Promise<void> }).started;
    let didStart = false;
    void started?.then(() => { didStart = true; });

    const playback = unit.play();
    await Promise.resolve();
    expect(started).toBeInstanceOf(Promise);
    expect(didStart).toBe(false);

    audios[0].dispatchEvent(new Event('playing'));
    await expect(started).resolves.toBeUndefined();
    audios[0].dispatchEvent(new Event('ended'));
    await playback;
  });

  it('supports pause, resume, and stop while settling playback', async () => {
    const { adapter, audios } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);
    const playback = unit.play();

    unit.pause();
    await unit.resume();
    unit.stop();

    expect(audios[0].pause).toHaveBeenCalledTimes(2);
    expect(audios[0].play).toHaveBeenCalledTimes(2);
    expect(audios[0].currentTime).toBe(0);
    await expect(playback).resolves.toBeUndefined();
  });

  it('disposes listeners without revoking a cache-owned URL', async () => {
    const { adapter, audios, revokeObjectURL } = createHarness();
    const unit = await adapter.prepare(segment, context, new AbortController().signal);
    const playback = unit.play();
    unit.dispose();

    audios[0].dispatchEvent(new Event('ended'));
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unit.stop();
    await expect(playback).resolves.toBeUndefined();
  });

  it('revokes only an uncached oversized Blob URL during disposal', async () => {
    const fetchAudio = vi.fn(async () => new Blob([new Uint8Array(5)], { type: 'audio/mpeg' }));
    const { adapter, revokeObjectURL } = createHarness({ fetchAudio, maxBytes: 4 });
    const unit = await adapter.prepare(segment, context, new AbortController().signal);

    unit.dispose();
    unit.dispose();

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:voxtral-1');
  });

  it('forwards request aborts as cancellation without creating Audio', async () => {
    const fetchAudio = vi.fn(async (_segment, _language, _voiceId, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new TTSAdapterError('cancelled', 'Voxtral request was cancelled')));
      });
      return new Blob();
    });
    const { adapter, audios } = createHarness({ fetchAudio });
    const controller = new AbortController();
    const preparation = adapter.prepare(segment, context, controller.signal);

    controller.abort();

    await expect(preparation).rejects.toMatchObject({ category: 'cancelled' });
    expect(audios).toHaveLength(0);
  });

  it('sanitizes unexpected request failures', async () => {
    const fetchAudio = vi.fn(async () => {
      throw new Error('private upstream response body');
    });
    const { adapter } = createHarness({ fetchAudio });

    const error = await adapter.prepare(segment, context, new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({
      category: 'upstream',
      message: 'Voxtral audio request failed',
    });
    expect(String(error)).not.toContain('private upstream response body');
  });

  it('maps media decode and play failures to safe invalid-audio errors', async () => {
    const first = createHarness();
    const firstUnit = await first.adapter.prepare(segment, context, new AbortController().signal);
    const decodePlayback = firstUnit.play();
    first.audios[0].dispatchEvent(new Event('error'));
    await expect(decodePlayback).rejects.toMatchObject({
      category: 'invalid_audio',
      message: 'Voxtral audio playback failed',
    });

    const second = createHarness();
    const secondUnit = await second.adapter.prepare(segment, context, new AbortController().signal);
    second.audios[0].play.mockRejectedValueOnce(new Error('private decoder detail'));
    await expect(secondUnit.play()).rejects.toMatchObject({
      category: 'invalid_audio',
      message: 'Voxtral audio playback failed',
    });

    const third = createHarness();
    const thirdUnit = await third.adapter.prepare(segment, context, new AbortController().signal);
    third.audios[0].play.mockImplementationOnce(() => {
      throw new Error('private synchronous decoder detail');
    });
    await expect(thirdUnit.play()).rejects.toMatchObject({
      category: 'invalid_audio',
      message: 'Voxtral audio playback failed',
    });
  });
});
