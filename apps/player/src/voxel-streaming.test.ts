import { describe, expect, it } from 'vitest';
import { selectVoxelStreamingWindow } from './voxel-streaming.js';

const dimensions = { x: 16, y: 16, z: 16 };
const candidate = (x: number, y: number, z: number) => ({
  coordinate: { x, y, z },
  value: `${x},${y},${z}`,
});

describe('Player voxel streaming window', () => {
  it('selects only chunks inside the camera-centered horizontal and vertical radii', () => {
    const result = selectVoxelStreamingWindow(
      [candidate(0, 0, 0), candidate(1, 0, 0), candidate(2, 0, 0), candidate(0, 2, 0)],
      [15.9, 0, 0],
      1,
      dimensions,
      1,
      0,
    );
    expect(result.map(({ value }) => value)).toEqual(['0,0,0', '1,0,0']);
  });

  it('uses floor semantics for negative world positions and non-unit voxel sizes', () => {
    const result = selectVoxelStreamingWindow(
      [candidate(-2, 0, 0), candidate(-1, 0, 0), candidate(0, 0, 0)],
      [-0.01, 0, 0],
      0.5,
      dimensions,
      1,
      0,
    );
    expect(result.map(({ value }) => value)).toEqual(['-1,0,0', '-2,0,0', '0,0,0']);
  });

  it('tracks repeated forward and reverse crossings at exact chunk boundaries', () => {
    const candidates = Array.from({ length: 9 }, (_, index) => candidate(index - 4, 0, 0));
    const positions = [15.99, 16, 31.99, 32, 31.99, 16, 15.99, 0, -0.01, -16];
    const centers = [0, 1, 1, 2, 1, 1, 0, 0, -1, -1];

    for (const [index, position] of positions.entries()) {
      const result = selectVoxelStreamingWindow(candidates, [position, 0, 0], 1, dimensions, 1, 0);
      expect(result.map(({ coordinate }) => coordinate.x)).toContain(centers[index]);
      expect(result.every(({ coordinate }) => Math.abs(coordinate.x - centers[index]!) <= 1)).toBe(
        true,
      );
    }
  });

  it('prioritizes nearest chunks and uses stable coordinate tie-breakers', () => {
    const result = selectVoxelStreamingWindow(
      [candidate(0, 0, 1), candidate(1, 0, 0), candidate(0, 0, 0)],
      [0, 0, 0],
      1,
      dimensions,
      1,
      1,
    );
    expect(result.map(({ value }) => value)).toEqual(['0,0,0', '1,0,0', '0,0,1']);
  });

  it('rejects invalid radii, dimensions, camera positions and duplicate coordinates', () => {
    expect(() => selectVoxelStreamingWindow([], [0, 0, 0], 1, dimensions, -1)).toThrow();
    expect(() => selectVoxelStreamingWindow([], [0, Number.NaN, 0], 1, dimensions, 1)).toThrow();
    expect(() =>
      selectVoxelStreamingWindow([], [0, 0, 0], 1, { ...dimensions, x: 0 }, 1),
    ).toThrow();
    expect(() =>
      selectVoxelStreamingWindow(
        [candidate(0, 0, 0), candidate(0, 0, 0)],
        [0, 0, 0],
        1,
        dimensions,
        1,
      ),
    ).toThrow('Duplicate voxel streaming coordinate');
  });
});

describe('Player large-world streaming stress', () => {
  it('keeps the active window bounded across a 1,000-chunk forward and reverse traversal', async () => {
    const { pruneVoxelSourceCache, readVoxelSourceCache, writeVoxelSourceCache } =
      await import('./voxel-source-cache.js');
    const candidates = Array.from({ length: 1_000 }, (_, x) => candidate(x, 0, 0));
    const candidateKeys = new Set(candidates.map(({ coordinate }) => `${coordinate.x},0,0`));
    const sourceCache = new Map<string, number>();
    let maxActive = 0;
    let maxCached = 0;
    let sourceReads = 0;
    let previousCenter = -1;

    const traversal = [
      ...Array.from({ length: 1_000 }, (_, index) => index),
      ...Array.from({ length: 999 }, (_, index) => 998 - index),
    ];

    for (const center of traversal) {
      const selected = selectVoxelStreamingWindow(
        candidates,
        [center * 16 + 8, 0, 0],
        1,
        dimensions,
        2,
        0,
      );
      const desiredKeys = new Set(
        selected.map(({ coordinate }) => `${coordinate.x},${coordinate.y},${coordinate.z}`),
      );
      const keepKeys = new Set(desiredKeys);
      for (const entry of selected) {
        for (const dx of [-1, 1]) {
          const neighborKey = `${entry.coordinate.x + dx},0,0`;
          if (candidateKeys.has(neighborKey)) keepKeys.add(neighborKey);
        }
      }

      pruneVoxelSourceCache(sourceCache, keepKeys);
      for (const key of keepKeys) {
        if (readVoxelSourceCache(sourceCache, key) === undefined) {
          sourceReads += 1;
          writeVoxelSourceCache(sourceCache, key, Number(key.split(',')[0]), 256);
        }
      }

      maxActive = Math.max(maxActive, selected.length);
      maxCached = Math.max(maxCached, sourceCache.size);
      expect(selected.every(({ coordinate }) => Math.abs(coordinate.x - center) <= 2)).toBe(true);
      expect(sourceCache.size).toBeLessThanOrEqual(256);
      expect(
        center === previousCenter ||
          Math.abs(center - previousCenter) === 1 ||
          previousCenter === -1,
      ).toBe(true);
      previousCenter = center;
    }

    expect(maxActive).toBe(5);
    expect(maxCached).toBeLessThanOrEqual(7);
    expect(sourceCache.size).toBeLessThanOrEqual(7);
    expect(sourceReads).toBeGreaterThan(1_000);
    expect(sourceReads).toBeLessThan(3_000);
  });
});
