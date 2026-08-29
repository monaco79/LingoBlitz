const DEFAULT_MAX_ENTRIES = 40;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

interface AudioCacheEntry {
  byteLength: number;
  leaseCount: number;
  retained: boolean;
  revoked: boolean;
  url: string;
}

export interface AudioCacheLease {
  readonly url: string;
  release(): void;
}

export interface AudioCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

export class AudioCache {
  private readonly entries = new Map<string, AudioCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;
  private byteLength = 0;

  constructor(options: AudioCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectURL = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));

    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError('Audio cache entry limit must be a positive integer');
    }

    if (!Number.isFinite(this.maxBytes) || this.maxBytes < 1) {
      throw new RangeError('Audio cache byte limit must be positive');
    }
  }

  get(key: string): string | undefined {
    return this.touch(key)?.url;
  }

  acquire(key: string): AudioCacheLease | undefined {
    const entry = this.touch(key);
    return entry ? this.createLease(entry) : undefined;
  }

  set(key: string, blob: Blob): string | undefined {
    if (blob.size > this.maxBytes) return undefined;
    return this.store(key, blob).url;
  }

  setAndAcquire(key: string, blob: Blob): AudioCacheLease {
    if (blob.size > this.maxBytes) {
      return this.createLease(this.createEntry(blob, false));
    }
    return this.createLease(this.store(key, blob));
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    this.entries.delete(key);
    this.byteLength -= entry.byteLength;
    entry.retained = false;
    this.revokeIfUnowned(entry);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) {
      this.delete(key);
    }
  }

  private createEntry(blob: Blob, retained: boolean): AudioCacheEntry {
    return {
      byteLength: blob.size,
      leaseCount: 0,
      retained,
      revoked: false,
      url: this.createObjectURL(blob),
    };
  }

  private createLease(entry: AudioCacheEntry): AudioCacheLease {
    entry.leaseCount += 1;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        entry.leaseCount -= 1;
        this.revokeIfUnowned(entry);
      },
    };
  }

  private store(key: string, blob: Blob): AudioCacheEntry {
    this.delete(key);
    const entry = this.createEntry(blob, true);
    this.entries.set(key, entry);
    this.byteLength += entry.byteLength;

    while (this.entries.size > this.maxEntries || this.byteLength > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }

    return entry;
  }

  private touch(key: string): AudioCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  private revokeIfUnowned(entry: AudioCacheEntry): void {
    if (entry.retained || entry.leaseCount > 0 || entry.revoked) return;
    entry.revoked = true;
    this.revokeObjectURL(entry.url);
  }
}
