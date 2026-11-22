import { describe, expect, it } from 'vitest';
import {
  fulfilledVoxelNeighbors,
  pruneVoxelSourceCache,
  readVoxelSourceCache,
  writeVoxelSourceCache,
} from './voxel-source-cache.js';

describe('voxel source cache', () => {
  it('refreshes recently read entries and evicts the least recently used entry at capacity', () => {
    const cache = new Map<string, number>();
    writeVoxelSourceCache(cache, 'a', 1, 2);
    writeVoxelSourceCache(cache, 'b', 2, 2);

    expect(readVoxelSourceCache(cache, 'a')).toBe(1);
    writeVoxelSourceCache(cache, 'c', 3, 2);

    expect([...cache.entries()]).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
  });

  it('enforces the 256-entry production bound during large-world traversal', () => {
    const cache = new Map<string, number>();
    for (let index = 0; index < 1_000; index += 1) {
      writeVoxelSourceCache(cache, `chunk-${index}`, index);
    }

    expect(cache.size).toBe(256);
    expect(cache.has('chunk-0')).toBe(false);
    expect(cache.has('chunk-743')).toBe(false);
    expect(cache.has('chunk-744')).toBe(true);
    expect(cache.has('chunk-999')).toBe(true);
  });

  it('prunes entries outside the active window and its retained neighbor ring', () => {
    const cache = new Map([
      ['active', 1],
      ['neighbor', 2],
      ['stale', 3],
    ]);
    pruneVoxelSourceCache(cache, new Set(['active', 'neighbor']));
    expect([...cache.entries()]).toEqual([
      ['active', 1],
      ['neighbor', 2],
    ]);
  });

  it('keeps successful neighbor payloads when another neighbor is corrupt or unavailable', async () => {
    const [positiveX, negativeX, positiveY] = fulfilledVoxelNeighbors(
      await Promise.allSettled([
        Promise.resolve('valid-positive-x'),
        Promise.reject(new Error('corrupt neighbor payload')),
        Promise.resolve('valid-positive-y'),
      ]),
    );

    expect(positiveX).toBe('valid-positive-x');
    expect(negativeX).toBeUndefined();
    expect(positiveY).toBe('valid-positive-y');
  });

  it('rejects invalid cache capacities', () => {
    expect(() => writeVoxelSourceCache(new Map(), 'a', 1, 0)).toThrow(RangeError);
    expect(() => writeVoxelSourceCache(new Map(), 'a', 1, 1.5)).toThrow(RangeError);
  });
});
