import type { Language, TTSProvider, TTSSettings } from '../../types';
import { getTTSPreference } from './settings';
import {
  TTSAdapterError,
  type AdapterContext,
  type PlaybackUnit,
  type SpeechAdapter,
  type SpeechSegment,
} from './types';

const PREPARE_LOOKAHEAD = 3;
const VOXTRAL_MODEL_MARKER = 'voxtral-mini-tts-2603';

export interface PlaybackSnapshot {
  status: 'idle' | 'loading' | 'playing' | 'paused';
  activeSegmentId: string | null;
  source: TTSProvider | null;
  ownerId: string | null;
}

export interface PlaybackRequest {
  ownerId: string;
  segments: SpeechSegment[];
  language: Language;
  settings: TTSSettings;
  onFallback?: () => void;
}

export interface PlaybackControllerOptions {
  adapters: Record<TTSProvider, SpeechAdapter>;
  resolvePreference?: typeof getTTSPreference;
}

type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

interface Deferred {
  promise: Promise<void>;
  reject(error: unknown): void;
  resolve(): void;
  settled: boolean;
}

type PreparationResult =
  | { kind: 'cancelled' }
  | { kind: 'error'; error: unknown }
  | { kind: 'unit'; unit: PlaybackUnit };

interface PreparationEntry {
  promise: Promise<PreparationResult>;
  unit: PlaybackUnit | null;
}

interface PlaybackOperation {
  cancelled: boolean;
  context: AdapterContext;
  currentIndex: number;
  currentUnit: PlaybackUnit | null;
  currentUnitStarted: boolean;
  deferred: Deferred;
  fallbackNotified: boolean;
  preparations: Map<number, PreparationEntry>;
  pauseRequested: boolean;
  request: PlaybackRequest;
  resumeGate: Deferred | null;
  segments: SpeechSegment[];
  source: TTSProvider;
  stageAbort: AbortController;
  stageVersion: number;
  token: number;
  voxtralFailureIndex: number | null;
}

const createDeferred = (): Deferred => {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const result: Deferred = {
    promise: new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    reject(error: unknown) {
      if (result.settled) return;
      result.settled = true;
      rejectPromise(error);
    },
    resolve() {
      if (result.settled) return;
      result.settled = true;
      resolvePromise();
    },
    settled: false,
  };
  return result;
};

const idleSnapshot = (): PlaybackSnapshot => ({
  status: 'idle',
  activeSegmentId: null,
  source: null,
  ownerId: null,
});

const sameSnapshot = (left: PlaybackSnapshot, right: PlaybackSnapshot): boolean =>
  left.status === right.status
  && left.activeSegmentId === right.activeSegmentId
  && left.source === right.source
  && left.ownerId === right.ownerId;

const stopAndDispose = (unit: PlaybackUnit): void => {
  unit.stop();
  unit.dispose();
};

export class PlaybackController {
  private readonly adapters: Record<TTSProvider, SpeechAdapter>;
  private readonly listeners = new Set<PlaybackListener>();
  private readonly resolvePreference: typeof getTTSPreference;
  private currentOperation: PlaybackOperation | null = null;
  private nextToken = 0;
  private snapshot = idleSnapshot();

  constructor(options: PlaybackControllerOptions) {
    this.adapters = options.adapters;
    this.resolvePreference = options.resolvePreference ?? getTTSPreference;
  }

  play(request: PlaybackRequest): Promise<void> {
    this.cancelCurrentOperation();

    const preference = this.resolvePreference(request.settings, request.language);
    const source = preference.provider;
    const operation: PlaybackOperation = {
      cancelled: false,
      context: this.createContext(request, source),
      currentIndex: 0,
      currentUnit: null,
      currentUnitStarted: false,
      deferred: createDeferred(),
      fallbackNotified: false,
      preparations: new Map(),
      pauseRequested: false,
      request,
      resumeGate: null,
      segments: request.segments.filter(({ spokenText }) => spokenText.trim().length > 0),
      source,
      stageAbort: new AbortController(),
      stageVersion: 0,
      token: ++this.nextToken,
      voxtralFailureIndex: null,
    };
    this.currentOperation = operation;
    this.setSnapshot({
      status: 'loading',
      activeSegmentId: null,
      source,
      ownerId: request.ownerId,
    });
    this.ensureLookahead(operation);
    void this.run(operation);
    return operation.deferred.promise;
  }

  pause(): void {
    const operation = this.currentOperation;
    if (!operation || this.snapshot.status === 'idle') return;

    operation.pauseRequested = true;
    if (operation.currentUnitStarted) {
      operation.currentUnit?.pause();
    } else {
      operation.resumeGate ??= createDeferred();
    }
    this.setSnapshot({ ...this.snapshot, status: 'paused' });
  }

  resume(): void {
    const operation = this.currentOperation;
    if (!operation || !operation.pauseRequested) return;

    operation.pauseRequested = false;
    const resumeGate = operation.resumeGate;
    operation.resumeGate = null;
    resumeGate?.resolve();
    if (operation.currentUnitStarted) {
      void operation.currentUnit?.resume().catch(() => undefined);
      this.setSnapshot({ ...this.snapshot, status: 'playing' });
    } else {
      this.setSnapshot({ ...this.snapshot, status: 'loading' });
    }
  }

  stop(): void {
    this.cancelCurrentOperation();
    this.setSnapshot(idleSnapshot());
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): PlaybackSnapshot {
    return this.snapshot;
  }

  private createContext(request: PlaybackRequest, source: TTSProvider): AdapterContext {
    const preference = this.resolvePreference(request.settings, request.language);
    return {
      language: request.language,
      voiceId: source === 'voxtral' ? preference.voxtralVoiceId : preference.browserVoiceName,
      speed: request.settings.speed,
      modelMarker: source === 'voxtral' ? VOXTRAL_MODEL_MARKER : 'browser',
    };
  }

  private ensureLookahead(operation: PlaybackOperation): void {
    if (!this.isCurrent(operation)) return;
    if (operation.source === 'voxtral' && operation.voxtralFailureIndex !== null) return;
    const end = Math.min(operation.segments.length, operation.currentIndex + PREPARE_LOOKAHEAD);
    for (let index = operation.currentIndex; index < end; index += 1) {
      if (!operation.preparations.has(index)) {
        this.startPreparation(operation, index);
      }
    }
  }

  private startPreparation(operation: PlaybackOperation, index: number): void {
    const stageVersion = operation.stageVersion;
    const source = operation.source;
    const entry: PreparationEntry = {
      promise: Promise.resolve({ kind: 'cancelled' }),
      unit: null,
    };
    operation.preparations.set(index, entry);
    entry.promise = this.adapters[operation.source]
      .prepare(operation.segments[index], operation.context, operation.stageAbort.signal)
      .then<PreparationResult>((unit) => {
        if (!this.isCurrentStage(operation, stageVersion)) {
          stopAndDispose(unit);
          return { kind: 'cancelled' };
        }
        entry.unit = unit;
        return { kind: 'unit', unit };
      })
      .catch<PreparationResult>((error: unknown) => {
        if (
          source === 'voxtral'
          && !this.isCancellation(error)
          && this.isCurrentStage(operation, stageVersion)
        ) {
          operation.voxtralFailureIndex = operation.voxtralFailureIndex === null
            ? index
            : Math.min(operation.voxtralFailureIndex, index);
        }
        return { kind: 'error', error };
      });
  }

  private async run(operation: PlaybackOperation): Promise<void> {
    try {
      while (this.isCurrent(operation) && operation.currentIndex < operation.segments.length) {
        this.ensureLookahead(operation);
        const entry = operation.preparations.get(operation.currentIndex);
        if (!entry) break;
        const result = await entry.promise;
        if (!this.isCurrent(operation)) break;
        operation.preparations.delete(operation.currentIndex);

        if (result.kind === 'cancelled') break;
        if (result.kind === 'error') {
          if (this.tryFallback(operation, result.error)) continue;
          throw result.error;
        }

        const segment = operation.segments[operation.currentIndex];
        entry.unit = null;
        operation.currentUnit = result.unit;
        if (operation.pauseRequested) {
          const resumeGate = operation.resumeGate ?? createDeferred();
          operation.resumeGate = resumeGate;
          await resumeGate.promise;
          if (!this.isCurrent(operation)) break;
        }
        let playback: Promise<void>;
        try {
          playback = result.unit.play();
        } catch (error) {
          if (this.tryFallback(operation, error)) continue;
          throw error;
        }
        void playback.catch(() => undefined);
        try {
          await result.unit.started;
        } catch (error) {
          if (this.tryFallback(operation, error)) continue;
          throw error;
        }
        if (!this.isCurrent(operation)) break;
        operation.currentUnitStarted = true;
        this.setSnapshot({
          status: operation.pauseRequested ? 'paused' : 'playing',
          activeSegmentId: segment.visibleSentenceId,
          source: operation.source,
          ownerId: operation.request.ownerId,
        });
        if (operation.pauseRequested) {
          result.unit.pause();
          const resumeGate = operation.resumeGate ?? createDeferred();
          operation.resumeGate = resumeGate;
          await resumeGate.promise;
          if (!this.isCurrent(operation)) break;
        }
        try {
          await playback;
        } catch (error) {
          if (this.tryFallback(operation, error)) continue;
          throw error;
        }
        if (!this.isCurrent(operation)) break;

        operation.currentUnit = null;
        operation.currentUnitStarted = false;
        result.unit.dispose();
        operation.currentIndex += 1;
        this.ensureLookahead(operation);

        const nextSegment = operation.segments[operation.currentIndex];
        if (nextSegment && nextSegment.visibleSentenceId !== segment.visibleSentenceId) {
          this.setSnapshot({
            status: operation.pauseRequested ? 'paused' : 'loading',
            activeSegmentId: null,
            source: operation.source,
            ownerId: operation.request.ownerId,
          });
        }
      }

      if (this.isCurrent(operation)) {
        this.currentOperation = null;
        this.setSnapshot(idleSnapshot());
        operation.deferred.resolve();
      }
    } catch (error) {
      if (!this.isCurrent(operation)) {
        operation.deferred.resolve();
        return;
      }
      this.disposeOperationResources(operation);
      this.currentOperation = null;
      this.setSnapshot(idleSnapshot());
      operation.deferred.reject(error);
    }
  }

  private cancelCurrentOperation(): void {
    const operation = this.currentOperation;
    if (!operation) return;

    operation.cancelled = true;
    operation.stageAbort.abort();
    operation.resumeGate?.resolve();
    operation.resumeGate = null;
    this.disposeOperationResources(operation);
    this.currentOperation = null;
    operation.deferred.resolve();
  }

  private tryFallback(operation: PlaybackOperation, error: unknown): boolean {
    if (
      operation.source !== 'voxtral'
      || this.isCancellation(error)
      || !this.isCurrent(operation)
    ) {
      return false;
    }

    operation.stageVersion += 1;
    operation.stageAbort.abort();
    this.disposeOperationResources(operation);
    operation.source = 'browser';
    operation.context = this.createContext(operation.request, 'browser');
    operation.stageAbort = new AbortController();
    operation.voxtralFailureIndex = null;

    this.setSnapshot({
      status: operation.pauseRequested ? 'paused' : 'loading',
      activeSegmentId: null,
      source: 'browser',
      ownerId: operation.request.ownerId,
    });
    if (!this.isCurrent(operation)) return true;
    this.ensureLookahead(operation);
    if (!this.isCurrent(operation)) return true;

    if (!operation.fallbackNotified) {
      operation.fallbackNotified = true;
      try {
        operation.request.onFallback?.();
      } catch {
        // Notification failure must not interrupt the provider transition.
      }
    }
    return true;
  }

  private isCancellation(error: unknown): boolean {
    return (error instanceof TTSAdapterError && error.category === 'cancelled')
      || (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError');
  }

  private disposeOperationResources(operation: PlaybackOperation): void {
    if (operation.currentUnit) {
      stopAndDispose(operation.currentUnit);
      operation.currentUnit = null;
      operation.currentUnitStarted = false;
    }
    for (const entry of operation.preparations.values()) {
      if (entry.unit) {
        stopAndDispose(entry.unit);
        entry.unit = null;
      }
    }
    operation.preparations.clear();
  }

  private isCurrent(operation: PlaybackOperation): boolean {
    return !operation.cancelled
      && this.currentOperation === operation
      && this.currentOperation.token === operation.token;
  }

  private isCurrentStage(operation: PlaybackOperation, stageVersion: number): boolean {
    return this.isCurrent(operation) && operation.stageVersion === stageVersion;
  }

  private setSnapshot(nextSnapshot: PlaybackSnapshot): void {
    if (sameSnapshot(this.snapshot, nextSnapshot)) return;
    this.snapshot = nextSnapshot;
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}
