const DEFAULT_MAX_ENTRIES = 40;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

interface AudioCacheEntry {
  byteLength: number;
  url: string;
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
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.url;
  }

  set(key: string, blob: Blob): string | undefined {
    if (blob.size > this.maxBytes) {
      return undefined;
    }

    this.delete(key);

    const entry = {
      byteLength: blob.size,
      url: this.createObjectURL(blob),
    };
    this.entries.set(key, entry);
    this.byteLength += entry.byteLength;

    while (this.entries.size > this.maxEntries || this.byteLength > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.delete(oldestKey);
    }

    return entry.url;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    this.entries.delete(key);
    this.byteLength -= entry.byteLength;
    this.revokeObjectURL(entry.url);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) {
      this.delete(key);
    }
  }
}
