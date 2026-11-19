import { describe, expect, it } from 'vitest';
import {
  chunkCoordinateKey,
  createChunkCoordinate,
  parseChunkCoordinateKey,
  WorldCoordinateError,
  worldPointToChunkAddress,
} from './index.js';

const dimensions = { x: 16, y: 16, z: 16 };

function expectWorldError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WorldCoordinateError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected WorldCoordinateError with code ${code}`);
}

describe('world chunk coordinates', () => {
  it('maps positive world positions to chunk and local cell coordinates', () => {
    expect(worldPointToChunkAddress({ x: 17.25, y: 2, z: 31.99 }, 1, dimensions)).toEqual({
      chunk: { x: 1, y: 0, z: 1 },
      cell: { x: 1, y: 2, z: 15 },
      globalCell: { x: 17, y: 2, z: 31 },
    });
  });

  it('uses floor partitioning for negative positions', () => {
    expect(worldPointToChunkAddress({ x: -0.01, y: -16, z: -16.01 }, 1, dimensions)).toEqual({
      chunk: { x: -1, y: -1, z: -2 },
      cell: { x: 15, y: 0, z: 15 },
      globalCell: { x: -1, y: -16, z: -17 },
    });
  });

  it('assigns exact positive and negative boundaries to one chunk', () => {
    expect(worldPointToChunkAddress({ x: 16, y: -16, z: 0 }, 1, dimensions)).toEqual({
      chunk: { x: 1, y: -1, z: 0 },
      cell: { x: 0, y: 0, z: 0 },
      globalCell: { x: 16, y: -16, z: 0 },
    });
  });

  it('scales world meters by an explicit voxel size', () => {
    expect(worldPointToChunkAddress({ x: 4, y: 0, z: 0 }, 0.5, dimensions)).toEqual({
      chunk: { x: 0, y: 0, z: 0 },
      cell: { x: 8, y: 0, z: 0 },
      globalCell: { x: 8, y: 0, z: 0 },
    });
  });

  it('round-trips stable chunk coordinate keys', () => {
    const coordinate = createChunkCoordinate({ x: -12, y: 0, z: 34 });
    expect(Object.isFrozen(coordinate)).toBe(true);
    expect(chunkCoordinateKey(coordinate)).toBe('-12,0,34');
    expect(parseChunkCoordinateKey('-12,0,34')).toEqual(coordinate);
  });

  it('rejects non-canonical keys and unsafe chunk coordinates', () => {
    expect(() => parseChunkCoordinateKey('01,0,0')).toThrow(WorldCoordinateError);
    expect(() => parseChunkCoordinateKey('-0,0,0')).toThrow(WorldCoordinateError);
    expect(() => parseChunkCoordinateKey('1, 0,0')).toThrow(WorldCoordinateError);
    expect(() => createChunkCoordinate({ x: Number.MAX_SAFE_INTEGER + 1, y: 0, z: 0 })).toThrow(
      WorldCoordinateError,
    );
  });

  it('rejects invalid voxel sizes, dimensions, and positions with stable codes', () => {
    expectWorldError(
      () => worldPointToChunkAddress({ x: 0, y: 0, z: 0 }, 0, dimensions),
      'INVALID_VOXEL_SIZE',
    );
    expectWorldError(
      () => worldPointToChunkAddress({ x: 0, y: 0, z: 0 }, 1, { x: 0, y: 16, z: 16 }),
      'INVALID_CHUNK_DIMENSIONS',
    );
    expectWorldError(
      () => worldPointToChunkAddress({ x: Number.NaN, y: 0, z: 0 }, 1, dimensions),
      'NON_FINITE_WORLD_POSITION',
    );
    expectWorldError(
      () => worldPointToChunkAddress({ x: Number.MAX_VALUE, y: 0, z: 0 }, 1, dimensions),
      'COORDINATE_OUT_OF_RANGE',
    );
  });
});
