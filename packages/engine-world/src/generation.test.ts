import { describe, expect, it } from 'vitest';
import {
  createChunkGenerationContext,
  createSeededChunkRandom,
  WorldGenerationError,
  type WorldChunkGenerator,
} from './index.js';

const coordinate = { x: -2, y: 3, z: 7 };

function sample(random: () => number, count: number): number[] {
  return Array.from({ length: count }, () => random());
}

describe('deterministic chunk generation hooks', () => {
  it('repeats the same sequence for a seed and signed chunk coordinate', () => {
    expect(sample(createSeededChunkRandom('terrain-v1', coordinate), 12)).toEqual(
      sample(createSeededChunkRandom('terrain-v1', coordinate), 12),
    );
  });

  it('separates random streams by seed and coordinate', () => {
    const baseline = sample(createSeededChunkRandom(42, coordinate), 8);
    expect(sample(createSeededChunkRandom(43, coordinate), 8)).not.toEqual(baseline);
    expect(sample(createSeededChunkRandom(42, { ...coordinate, x: -1 }), 8)).not.toEqual(baseline);
  });

  it('returns values in the half-open unit interval', () => {
    const values = sample(createSeededChunkRandom(0, coordinate), 256);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('creates a frozen context with a deterministic generator hook and caller signal', () => {
    const controller = new AbortController();
    const context = createChunkGenerationContext('world-seed', coordinate, controller.signal);
    const generator: WorldChunkGenerator<number[]> = ({ random }) => sample(random, 4);

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.coordinate)).toBe(true);
    expect(context.signal).toBe(controller.signal);
    expect(generator(context)).toEqual(
      generator(createChunkGenerationContext('world-seed', coordinate, controller.signal)),
    );
  });

  it('rejects unsafe numeric and empty string seeds', () => {
    expect(() => createSeededChunkRandom(Number.NaN, coordinate)).toThrow(WorldGenerationError);
    expect(() => createSeededChunkRandom(Number.MAX_SAFE_INTEGER + 1, coordinate)).toThrow(
      WorldGenerationError,
    );
    expect(() => createSeededChunkRandom('', coordinate)).toThrow(WorldGenerationError);
  });
});
