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
