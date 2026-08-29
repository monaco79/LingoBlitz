import { describe, expect, it, vi } from 'vitest';

import { Language, type TTSProvider, type TTSSettings } from '../../types';
import { PlaybackController, type PlaybackRequest, type PlaybackSnapshot } from './playbackController';
import {
  TTSAdapterError,
  type AdapterContext,
  type PlaybackUnit,
  type SpeechAdapter,
  type SpeechSegment,
} from './types';

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

class ControlledUnit implements PlaybackUnit {
  private readonly completion = deferred<void>();
  private readonly startLifecycle = deferred<void>();

  readonly dispose = vi.fn();
  readonly pause = vi.fn();
  readonly play = vi.fn(() => {
    if (this.autoStart) this.startLifecycle.resolve();
    return this.completion.promise;
  });
  readonly resume = vi.fn(async () => undefined);
  readonly started = this.startLifecycle.promise;
  readonly stop = vi.fn(() => {
    this.startLifecycle.resolve();
    this.completion.resolve();
  });

  constructor(private readonly autoStart = true) {}

  start(): void {
    this.startLifecycle.resolve();
  }

  finish(): void {
    this.completion.resolve();
  }

  fail(error: Error): void {
    this.completion.reject(error);
  }
}

interface PreparationCall {
  context: AdapterContext;
  deferred: Deferred<PlaybackUnit>;
  segment: SpeechSegment;
  signal: AbortSignal;
  unit: ControlledUnit | null;
}

class ControlledAdapter implements SpeechAdapter {
  readonly calls: PreparationCall[] = [];
  maxActivePreparations = 0;
  private activePreparations = 0;

  constructor(private readonly rejectOnAbort = true) {}

  prepare(segment: SpeechSegment, context: AdapterContext, signal: AbortSignal): Promise<PlaybackUnit> {
    const preparation = deferred<PlaybackUnit>();
    const call: PreparationCall = {
      context,
      deferred: preparation,
      segment,
      signal,
      unit: null,
    };
    this.calls.push(call);
    this.activePreparations += 1;
    this.maxActivePreparations = Math.max(this.maxActivePreparations, this.activePreparations);

    if (this.rejectOnAbort) {
      signal.addEventListener('abort', () => {
        preparation.reject(new TTSAdapterError('cancelled', 'Preparation cancelled'));
      }, { once: true });
    }

    return preparation.promise.finally(() => {
      this.activePreparations -= 1;
    });
  }

  resolve(index: number, options: { autoStart?: boolean } = {}): ControlledUnit {
    const call = this.calls[index];
    const unit = new ControlledUnit(options.autoStart ?? true);
    call.unit = unit;
    call.deferred.resolve(unit);
    return unit;
  }

  reject(index: number, error: Error): void {
    this.calls[index].deferred.reject(error);
  }
}

const makeSegment = (
  index: number,
  visibleSentenceId = `sentence-${index}`,
  spokenText = `Sentence ${index}.`,
): SpeechSegment => ({
  id: `segment-${index}`,
  displayText: spokenText || '👋',
  spokenText,
  visibleSentenceId,
});

const makeSettings = (
  provider: TTSProvider = 'voxtral',
  language: Language = Language.German,
): TTSSettings => ({
  preferences: {
    [language]: {
      provider,
      voxtralVoiceId: 'voxtral-voice',
      browserVoiceName: 'browser-voice',
    },
  },
  speed: 0.9,
  autoRead: false,
});

const createHarness = (options: {
  resolveVoxtralVoice?: (language: Language, signal: AbortSignal) => Promise<string | null>;
  voxtralRejectsOnAbort?: boolean;
} = {}) => {
  const browser = new ControlledAdapter();
  const voxtral = new ControlledAdapter(options.voxtralRejectsOnAbort ?? true);
  const controllerOptions = {
    adapters: { browser, voxtral },
    resolveVoxtralVoice: options.resolveVoxtralVoice,
  };
  const controller = new PlaybackController(controllerOptions);

  return { browser, controller, voxtral };
};

const waitFor = async (assertion: () => void): Promise<void> => {
  await vi.waitFor(assertion, { interval: 1, timeout: 1_000 });
};

describe('PlaybackController queue and state', () => {
  it('retains request ownership through loading, fallback, and inter-sentence preparation', async () => {
    const { browser, controller, voxtral } = createHarness();
    const snapshots: PlaybackSnapshot[] = [];
    controller.subscribe((snapshot) => snapshots.push({ ...snapshot }));
    const playback = controller.play({
      ownerId: 'article',
      segments: [makeSegment(0), makeSegment(1)],
      language: Language.German,
      settings: makeSettings(),
    });

    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'article',
    });

    voxtral.reject(0, new TTSAdapterError('upstream', 'Voxtral unavailable'));
    await waitFor(() => expect(browser.calls).toHaveLength(2));
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      activeSegmentId: null,
      source: 'browser',
      ownerId: 'article',
    });

    const first = browser.resolve(0);
    const second = browser.resolve(1);
    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().ownerId).toBe('article');

    first.finish();
    await waitFor(() => expect(second.play).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot()).toEqual({
      status: 'playing',
      activeSegmentId: 'sentence-1',
      source: 'browser',
      ownerId: 'article',
    });

    second.finish();
    await playback;
    expect(snapshots.map(({ status, source, ownerId }) => [status, source, ownerId])).toEqual([
      ['loading', 'voxtral', 'article'],
      ['loading', 'browser', 'article'],
      ['playing', 'browser', 'article'],
      ['loading', 'browser', 'article'],
      ['playing', 'browser', 'article'],
      ['idle', null, null],
    ]);
    expect(controller.getSnapshot()).toEqual({
      status: 'idle',
      activeSegmentId: null,
      source: null,
      ownerId: null,
    });
  });

  it('moves from loading to playing exactly when the first audio unit begins', async () => {
    const { controller, voxtral } = createHarness();
    const snapshots: PlaybackSnapshot[] = [];
    controller.subscribe((snapshot) => snapshots.push({ ...snapshot }));

    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
    });

    expect(snapshots.at(-1)).toEqual({
      status: 'loading',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });

    const unit = voxtral.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));

    expect(snapshots.at(-1)).toEqual({
      status: 'playing',
      activeSegmentId: 'sentence-0',
      source: 'voxtral',
      ownerId: 'test-owner',
    });
    expect(snapshots.findIndex(({ status }) => status === 'loading'))
      .toBeLessThan(snapshots.findIndex(({ status }) => status === 'playing'));

    unit.finish();
    await playback;
    expect(snapshots.at(-1)).toEqual({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
  });

  it('keeps highlighting clear until the prepared unit reports actual playback start', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
    });

    const unit = voxtral.resolve(0, { autoStart: false });
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });

    unit.start();
    await waitFor(() => expect(controller.getSnapshot().activeSegmentId).toBe('sentence-0'));
    unit.finish();
    await playback;
  });

  it('does not publish a stale highlight when stopped before playback starts', async () => {
    const { controller, voxtral } = createHarness();
    const snapshots: PlaybackSnapshot[] = [];
    controller.subscribe((snapshot) => snapshots.push({ ...snapshot }));
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
    });

    const unit = voxtral.resolve(0, { autoStart: false });
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    controller.stop();
    unit.start();

    await playback;
    expect(controller.getSnapshot()).toEqual({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
    expect(snapshots.some(({ activeSegmentId }) => activeSegmentId === 'sentence-0')).toBe(false);
  });

  it('does not flicker the highlight between chunks of one visible sentence', async () => {
    const { controller, voxtral } = createHarness();
    const snapshots: PlaybackSnapshot[] = [];
    controller.subscribe((snapshot) => snapshots.push({ ...snapshot }));
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [
        makeSegment(0, 'sentence-shared', 'First chunk.'),
        makeSegment(1, 'sentence-shared', 'Second chunk.'),
        makeSegment(2, 'sentence-next', 'Next sentence.'),
      ],
      language: Language.German,
      settings: makeSettings(),
    });
    const first = voxtral.resolve(0);
    const second = voxtral.resolve(1);
    const third = voxtral.resolve(2);

    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));
    first.finish();
    await waitFor(() => expect(second.play).toHaveBeenCalledTimes(1));

    const sharedHighlights = snapshots.filter(({ activeSegmentId }) => activeSegmentId === 'sentence-shared');
    expect(sharedHighlights).toHaveLength(1);

    second.finish();
    await waitFor(() => expect(third.play).toHaveBeenCalledTimes(1));
    expect(snapshots.at(-1)?.activeSegmentId).toBe('sentence-next');
    third.finish();
    await playback;
  });

  it('caps preparation at three and advances a three-unit look-ahead window', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: Array.from({ length: 7 }, (_, index) => makeSegment(index)),
      language: Language.German,
      settings: makeSettings(),
    });

    expect(voxtral.calls.map(({ segment }) => segment.id)).toEqual([
      'segment-0',
      'segment-1',
      'segment-2',
    ]);
    expect(voxtral.maxActivePreparations).toBe(3);

    const first = voxtral.resolve(0);
    voxtral.resolve(1);
    voxtral.resolve(2);
    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));
    expect(voxtral.calls).toHaveLength(3);

    first.finish();
    await waitFor(() => expect(voxtral.calls).toHaveLength(4));
    expect(voxtral.calls[3].segment.id).toBe('segment-3');
    expect(voxtral.maxActivePreparations).toBeLessThanOrEqual(3);

    controller.stop();
    await playback;
  });

  it('plays in queue order when later preparations resolve first', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0), makeSegment(1), makeSegment(2)],
      language: Language.German,
      settings: makeSettings(),
    });
    const third = voxtral.resolve(2);
    const second = voxtral.resolve(1);

    await Promise.resolve();
    expect(second.play).not.toHaveBeenCalled();
    expect(third.play).not.toHaveBeenCalled();

    const first = voxtral.resolve(0);
    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));
    first.finish();
    await waitFor(() => expect(second.play).toHaveBeenCalledTimes(1));
    expect(third.play).not.toHaveBeenCalled();
    second.finish();
    await waitFor(() => expect(third.play).toHaveBeenCalledTimes(1));
    third.finish();
    await playback;
  });

  it('retains the active sentence while paused and resumes the same unit', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
    });
    const unit = voxtral.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));

    controller.pause();
    expect(unit.pause).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({
      status: 'paused',
      activeSegmentId: 'sentence-0',
      source: 'voxtral',
      ownerId: 'test-owner',
    });

    controller.resume();
    await waitFor(() => expect(unit.resume).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot()).toEqual({
      status: 'playing',
      activeSegmentId: 'sentence-0',
      source: 'voxtral',
      ownerId: 'test-owner',
    });
    unit.finish();
    await playback;
  });

  it('retains pause intent while slow preparation finishes and waits for resume before playing', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
    });

    controller.pause();
    expect(controller.getSnapshot()).toEqual({
      status: 'paused',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });

    const unit = voxtral.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(unit.play).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({
      status: 'paused',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });

    controller.resume();
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    expect(unit.resume).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({
      status: 'playing',
      activeSegmentId: 'sentence-0',
      source: 'voxtral',
      ownerId: 'test-owner',
    });
    unit.finish();
    await playback;
  });

  it('stays paused and can resume the next segment when the active unit settles', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0), makeSegment(1)],
      language: Language.German,
      settings: makeSettings(),
    });
    const first = voxtral.resolve(0);
    const second = voxtral.resolve(1);
    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));

    controller.pause();
    first.finish();
    await waitFor(() => expect(first.dispose).toHaveBeenCalledTimes(1));

    expect(second.play).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({
      status: 'paused',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });

    controller.resume();
    await waitFor(() => expect(second.play).toHaveBeenCalledTimes(1));
    second.finish();
    await expect(playback).resolves.toBeUndefined();
  });

  it('settles a replaced operation and ignores its late preparation', async () => {
    const { controller, voxtral } = createHarness({ voxtralRejectsOnAbort: false });
    const snapshots: PlaybackSnapshot[] = [];
    controller.subscribe((snapshot) => snapshots.push({ ...snapshot }));
    const firstPlayback = controller.play({
      ownerId: 'first-owner',
      segments: [makeSegment(0, 'first-sentence')],
      language: Language.German,
      settings: makeSettings(),
    });
    const firstSignal = voxtral.calls[0].signal;

    const secondPlayback = controller.play({
      ownerId: 'second-owner',
      segments: [makeSegment(1, 'second-sentence')],
      language: Language.German,
      settings: makeSettings(),
    });

    expect(firstSignal.aborted).toBe(true);
    expect(controller.getSnapshot().ownerId).toBe('second-owner');
    await expect(firstPlayback).resolves.toBeUndefined();

    const staleUnit = voxtral.resolve(0);
    const currentUnit = voxtral.resolve(1);
    await waitFor(() => expect(currentUnit.play).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(staleUnit.dispose).toHaveBeenCalledTimes(1));
    expect(staleUnit.play).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.activeSegmentId).toBe('second-sentence');

    currentUnit.finish();
    await secondPlayback;
  });

  it('stop clears highlighting and settles playback even if the unit is pending', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
    });
    const unit = voxtral.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));

    controller.stop();

    expect(controller.getSnapshot()).toEqual({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
    expect(unit.stop).toHaveBeenCalledTimes(1);
    expect(unit.dispose).toHaveBeenCalledTimes(1);
    await expect(playback).resolves.toBeUndefined();
  });

  it('skips silent audio units and advances to the next speakable visible sentence', async () => {
    const { controller, voxtral } = createHarness();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0, 'silent-sentence', ''), makeSegment(1, 'spoken-sentence')],
      language: Language.German,
      settings: makeSettings(),
    });

    expect(voxtral.calls).toHaveLength(1);
    expect(voxtral.calls[0].segment.visibleSentenceId).toBe('spoken-sentence');
    const unit = voxtral.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().activeSegmentId).toBe('spoken-sentence');

    unit.finish();
    await playback;
  });
});

describe('PlaybackController provider fallback', () => {
  it('lazily resolves and reports an empty Voxtral voice before first preparation', async () => {
    const resolveVoxtralVoice = vi.fn(async () => 'resolved-voice');
    const onVoxtralVoiceResolved = vi.fn();
    const { controller, voxtral } = createHarness({ resolveVoxtralVoice });
    const settings = makeSettings();
    settings.preferences[Language.German]!.voxtralVoiceId = '';
    settings.preferences[Language.Japanese] = {
      provider: 'browser',
      voxtralVoiceId: '',
      browserVoiceName: 'Kyoko',
    };
    const savedSettings = structuredClone(settings);
    const request = {
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings,
      onVoxtralVoiceResolved,
    } as PlaybackRequest & {
      onVoxtralVoiceResolved(language: Language, voiceId: string): void;
    };

    const playback = controller.play(request);
    await waitFor(() => expect(resolveVoxtralVoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(voxtral.calls).toHaveLength(1));

    expect(voxtral.calls[0].context.voiceId).toBe('resolved-voice');
    expect(resolveVoxtralVoice).toHaveBeenCalledWith(Language.German, expect.any(AbortSignal));
    expect(onVoxtralVoiceResolved).toHaveBeenCalledExactlyOnceWith(Language.German, 'resolved-voice');
    expect(settings).toEqual(savedSettings);

    const unit = voxtral.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    unit.finish();
    await playback;
  });

  it.each([
    ['no compatible preset', async () => null],
    ['voice discovery failure', async () => { throw new TTSAdapterError('upstream', 'Unavailable'); }],
  ])('falls back once when lazy resolution has %s', async (_case, resolveVoxtralVoice) => {
    const onFallback = vi.fn();
    const { browser, controller, voxtral } = createHarness({ resolveVoxtralVoice });
    const settings = makeSettings();
    settings.preferences[Language.German]!.voxtralVoiceId = '';
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings,
      onFallback,
    });

    await waitFor(() => expect(browser.calls).toHaveLength(1));
    expect(voxtral.calls).toHaveLength(0);
    expect(onFallback).toHaveBeenCalledTimes(1);
    const unit = browser.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    unit.finish();
    await playback;
  });

  it('does not notify fallback after a subscription listener stops the operation', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn();
    const unsubscribe = controller.subscribe((snapshot) => {
      if (snapshot.status === 'loading' && snapshot.source === 'browser') {
        controller.stop();
      }
    });
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    voxtral.reject(0, new TTSAdapterError('upstream', 'Voxtral unavailable'));

    await expect(playback).resolves.toBeUndefined();
    expect(controller.getSnapshot()).toEqual({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
    expect(browser.calls).toHaveLength(0);
    expect(onFallback).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not run stale onFallback after a subscription listener replaces playback', async () => {
    const { controller, voxtral } = createHarness();
    let replacementPlayback: Promise<void> | null = null;
    let replaced = false;
    const unsubscribe = controller.subscribe((snapshot) => {
      if (!replaced && snapshot.status === 'loading' && snapshot.source === 'browser') {
        replaced = true;
        replacementPlayback = controller.play({
          ownerId: 'test-owner',
          segments: [makeSegment(9, 'listener-replacement')],
          language: Language.German,
          settings: makeSettings('voxtral'),
        });
      }
    });
    const onFallback = vi.fn(() => controller.stop());
    const firstPlayback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    voxtral.reject(0, new TTSAdapterError('upstream', 'Voxtral unavailable'));

    await waitFor(() => expect(replacementPlayback).not.toBeNull());
    expect(onFallback).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });
    const replacementUnit = voxtral.resolve(1);
    await waitFor(() => expect(replacementUnit.play).toHaveBeenCalledTimes(1));
    replacementUnit.finish();

    await expect(firstPlayback).resolves.toBeUndefined();
    await expect(replacementPlayback!).resolves.toBeUndefined();
    unsubscribe();
  });

  it('keeps stop state authoritative when onFallback stops playback', async () => {
    const { controller, voxtral } = createHarness();
    const onFallback = vi.fn(() => controller.stop());
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    voxtral.reject(0, new TTSAdapterError('upstream', 'Voxtral unavailable'));

    await expect(playback).resolves.toBeUndefined();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
  });

  it('does not let an old fallback overwrite replacement state started by onFallback', async () => {
    const { controller, voxtral } = createHarness();
    let replacementPlayback: Promise<void> | null = null;
    const onFallback = vi.fn(() => {
      replacementPlayback = controller.play({
        ownerId: 'test-owner',
        segments: [makeSegment(9, 'replacement-sentence')],
        language: Language.German,
        settings: makeSettings('voxtral'),
      });
    });
    const firstPlayback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    voxtral.reject(0, new TTSAdapterError('upstream', 'Voxtral unavailable'));

    await waitFor(() => expect(replacementPlayback).not.toBeNull());
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      activeSegmentId: null,
      source: 'voxtral',
      ownerId: 'test-owner',
    });
    const replacementUnit = voxtral.resolve(1);
    await waitFor(() => expect(replacementUnit.play).toHaveBeenCalledTimes(1));
    replacementUnit.finish();

    await expect(firstPlayback).resolves.toBeUndefined();
    await expect(replacementPlayback!).resolves.toBeUndefined();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('continues browser fallback when onFallback throws', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn(() => {
      throw new Error('UI notification failed');
    });
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    void playback.catch(() => undefined);
    voxtral.reject(0, new TTSAdapterError('upstream', 'Voxtral unavailable'));

    await waitFor(() => expect(browser.calls).toHaveLength(1));
    const browserUnit = browser.resolve(0);
    await waitFor(() => expect(browserUnit.play).toHaveBeenCalledTimes(1));
    browserUnit.finish();

    await expect(playback).resolves.toBeUndefined();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('falls back when Voxtral playback throws before returning a promise', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    void playback.catch(() => undefined);
    const voxtralUnit = voxtral.resolve(0);
    voxtralUnit.play.mockImplementationOnce(() => {
      throw new TTSAdapterError('invalid_audio', 'Voxtral audio playback failed');
    });

    await waitFor(() => expect(browser.calls).toHaveLength(1));
    const browserUnit = browser.resolve(0);
    await waitFor(() => expect(browserUnit.play).toHaveBeenCalledTimes(1));
    browserUnit.finish();

    await expect(playback).resolves.toBeUndefined();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('falls back from the failed sentence without replaying completed sentences', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn();
    const settings = makeSettings();
    const savedSettings = structuredClone(settings);
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0), makeSegment(1), makeSegment(2), makeSegment(3)],
      language: Language.German,
      settings,
      onFallback,
    });
    void playback.catch(() => undefined);
    const first = voxtral.resolve(0);
    const speculativeThird = voxtral.resolve(2);
    voxtral.reject(1, new TTSAdapterError('upstream', 'Voxtral unavailable'));

    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));
    first.finish();

    await waitFor(() => expect(browser.calls.map(({ segment }) => segment.id)).toEqual([
      'segment-1',
      'segment-2',
      'segment-3',
    ]));
    expect(voxtral.calls).toHaveLength(3);
    expect(speculativeThird.stop).toHaveBeenCalledTimes(1);
    expect(speculativeThird.dispose).toHaveBeenCalledTimes(1);

    const second = browser.resolve(0);
    const third = browser.resolve(1);
    const fourth = browser.resolve(2);
    await waitFor(() => expect(second.play).toHaveBeenCalledTimes(1));
    second.finish();
    await waitFor(() => expect(third.play).toHaveBeenCalledTimes(1));
    third.finish();
    await waitFor(() => expect(fourth.play).toHaveBeenCalledTimes(1));
    fourth.finish();

    await expect(playback).resolves.toBeUndefined();
    expect(first.play).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(settings).toEqual(savedSettings);
  });

  it('does not expand Voxtral look-ahead after a known speculative index-3 failure', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn();
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: Array.from({ length: 5 }, (_, index) => makeSegment(index)),
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    void playback.catch(() => undefined);
    const first = voxtral.resolve(0);
    const second = voxtral.resolve(1);
    const third = voxtral.resolve(2);
    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));

    first.finish();
    await waitFor(() => expect(voxtral.calls).toHaveLength(4));
    await waitFor(() => expect(second.play).toHaveBeenCalledTimes(1));
    voxtral.reject(3, new TTSAdapterError('upstream', 'Speculative sentence failed'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(voxtral.calls).toHaveLength(4);

    second.finish();
    await waitFor(() => expect(third.play).toHaveBeenCalledTimes(1));
    expect(voxtral.calls).toHaveLength(4);
    third.finish();

    await waitFor(() => expect(browser.calls.map(({ segment }) => segment.id)).toEqual([
      'segment-3',
      'segment-4',
    ]));
    const fourth = browser.resolve(0);
    const fifth = browser.resolve(1);
    await waitFor(() => expect(fourth.play).toHaveBeenCalledTimes(1));
    fourth.finish();
    await waitFor(() => expect(fifth.play).toHaveBeenCalledTimes(1));
    fifth.finish();

    await expect(playback).resolves.toBeUndefined();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('fires onFallback only once when browser preparation also fails', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn();
    const browserError = new TTSAdapterError('upstream', 'Browser speech playback failed');
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0), makeSegment(1)],
      language: Language.German,
      settings: makeSettings(),
      onFallback,
    });
    void playback.catch(() => undefined);
    const first = voxtral.resolve(0);
    voxtral.reject(1, new TTSAdapterError('timeout', 'Voxtral request failed'));
    await waitFor(() => expect(first.play).toHaveBeenCalledTimes(1));
    first.finish();
    await waitFor(() => expect(browser.calls).toHaveLength(1));
    browser.reject(0, browserError);

    await expect(playback).rejects.toBe(browserError);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({ status: 'idle', activeSegmentId: null, source: null, ownerId: null });
  });

  it('selects browser for an unsupported language without reporting fallback', async () => {
    const { browser, controller, voxtral } = createHarness();
    const onFallback = vi.fn();
    const settings = makeSettings('voxtral', Language.Japanese);
    const playback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.Japanese,
      settings,
      onFallback,
    });

    expect(voxtral.calls).toHaveLength(0);
    expect(browser.calls).toHaveLength(1);
    expect(browser.calls[0].context).toMatchObject({
      language: Language.Japanese,
      modelMarker: 'browser',
      voiceId: 'browser-voice',
    });
    const unit = browser.resolve(0);
    await waitFor(() => expect(unit.play).toHaveBeenCalledTimes(1));
    unit.finish();

    await playback;
    expect(onFallback).not.toHaveBeenCalled();
    expect(settings.preferences[Language.Japanese]?.provider).toBe('voxtral');
  });

  it('does not report fallback when replacement or stop aborts Voxtral preparation', async () => {
    const { controller } = createHarness();
    const firstFallback = vi.fn();
    const secondFallback = vi.fn();
    const firstPlayback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(0)],
      language: Language.German,
      settings: makeSettings(),
      onFallback: firstFallback,
    });
    const secondPlayback = controller.play({
      ownerId: 'test-owner',
      segments: [makeSegment(1)],
      language: Language.German,
      settings: makeSettings(),
      onFallback: secondFallback,
    });
    controller.stop();

    await expect(firstPlayback).resolves.toBeUndefined();
    await expect(secondPlayback).resolves.toBeUndefined();
    await Promise.resolve();
    expect(firstFallback).not.toHaveBeenCalled();
    expect(secondFallback).not.toHaveBeenCalled();
  });
});
