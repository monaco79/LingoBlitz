import { describe, expect, it, vi } from 'vitest';

import { AudioCache } from './audioCache';

const blobOfSize = (size: number) => new Blob([new Uint8Array(size)], { type: 'audio/mpeg' });

const createCache = (maxEntries: number, maxBytes: number) => {
  let nextUrl = 0;
  const createObjectURL = vi.fn(() => `blob:audio-${++nextUrl}`);
  const revokeObjectURL = vi.fn();
  const cache = new AudioCache({ maxEntries, maxBytes, createObjectURL, revokeObjectURL });

  return { cache, createObjectURL, revokeObjectURL };
};

describe('AudioCache', () => {
  it('defers eviction revocation until the last active lease releases', () => {
    const { cache, revokeObjectURL } = createCache(1, 100);
    const leasable = cache as AudioCache & {
      acquire(key: string): { url: string; release(): void } | undefined;
      setAndAcquire(key: string, blob: Blob): { url: string; release(): void };
    };

    expect(typeof leasable.acquire).toBe('function');
    expect(typeof leasable.setAndAcquire).toBe('function');
    const first = leasable.setAndAcquire('first', blobOfSize(10));
    const same = leasable.acquire('first');
    const second = leasable.setAndAcquire('second', blobOfSize(10));

    expect(revokeObjectURL).not.toHaveBeenCalledWith(first.url);
    first.release();
    expect(revokeObjectURL).not.toHaveBeenCalledWith(first.url);
    same?.release();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(first.url);

    second.release();
    cache.clear();
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === second.url)).toHaveLength(1);
  });

  it('evicts the least recently used entry after get refreshes access order', () => {
    const { cache, revokeObjectURL } = createCache(2, 100);
    const firstUrl = cache.set('first', blobOfSize(10));
    const secondUrl = cache.set('second', blobOfSize(10));

    expect(cache.get('first')).toBe(firstUrl);
    cache.set('third', blobOfSize(10));

    expect(cache.get('first')).toBe(firstUrl);
    expect(cache.get('second')).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(secondUrl);
  });

  it('evicts oldest entries until the byte limit is met', () => {
    const { cache, revokeObjectURL } = createCache(10, 10);
    const firstUrl = cache.set('first', blobOfSize(4));
    const secondUrl = cache.set('second', blobOfSize(4));

    const thirdUrl = cache.set('third', blobOfSize(5));

    expect(thirdUrl).toBe('blob:audio-3');
    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe(secondUrl);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(firstUrl);
  });

  it('rejects an oversized blob without evicting existing entries', () => {
    const { cache, createObjectURL, revokeObjectURL } = createCache(2, 10);
    const retainedUrl = cache.set('retained', blobOfSize(4));

    expect(cache.set('oversized', blobOfSize(11))).toBeUndefined();

    expect(cache.get('retained')).toBe(retainedUrl);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('replaces an entry and revokes its previous URL exactly once', () => {
    const { cache, revokeObjectURL } = createCache(2, 20);
    const oldUrl = cache.set('same', blobOfSize(4));

    const replacementUrl = cache.set('same', blobOfSize(5));

    expect(cache.get('same')).toBe(replacementUrl);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(oldUrl);
  });

  it('delete and clear revoke each owned URL exactly once', () => {
    const { cache, revokeObjectURL } = createCache(3, 30);
    const deletedUrl = cache.set('deleted', blobOfSize(4));
    const firstClearedUrl = cache.set('first-cleared', blobOfSize(4));
    const secondClearedUrl = cache.set('second-cleared', blobOfSize(4));

    cache.delete('deleted');
    cache.delete('deleted');
    cache.clear();
    cache.clear();

    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(revokeObjectURL).toHaveBeenCalledWith(deletedUrl);
    expect(revokeObjectURL).toHaveBeenCalledWith(firstClearedUrl);
    expect(revokeObjectURL).toHaveBeenCalledWith(secondClearedUrl);
  });
});
