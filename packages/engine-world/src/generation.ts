import { createChunkCoordinate, type ChunkCoordinate3 } from './index.js';

export type WorldSeed = number | string;

export interface WorldChunkGenerationContext {
  readonly seed: WorldSeed;
  readonly coordinate: ChunkCoordinate3;
  readonly signal: AbortSignal;
  readonly random: () => number;
}

export type WorldChunkGenerator<T> = (context: WorldChunkGenerationContext) => T | Promise<T>;

export type WorldGenerationErrorCode = 'INVALID_WORLD_SEED';

export class WorldGenerationError extends Error {
  constructor(
    readonly code: WorldGenerationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldGenerationError';
  }
}

function validateSeed(seed: WorldSeed): WorldSeed {
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed)) {
      throw new WorldGenerationError(
        'INVALID_WORLD_SEED',
        'Numeric world seeds must be safe integers',
      );
    }
    return seed;
  }
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new WorldGenerationError('INVALID_WORLD_SEED', 'String world seeds must not be empty');
  }
  return seed;
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Create a deterministic PRNG stream scoped to one seed and signed chunk coordinate. */
export function createSeededChunkRandom(
  seed: WorldSeed,
  coordinate: ChunkCoordinate3,
): () => number {
  const validatedSeed = validateSeed(seed);
  const chunk = createChunkCoordinate(coordinate);
  let state = hashSeed(
    String(typeof validatedSeed) +
      ':' +
      String(validatedSeed) +
      '|' +
      chunk.x +
      ',' +
      chunk.y +
      ',' +
      chunk.z,
  );

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build an immutable generator context for a cancellable chunk-generation job. */
export function createChunkGenerationContext(
  seed: WorldSeed,
  coordinate: ChunkCoordinate3,
  signal: AbortSignal,
): WorldChunkGenerationContext {
  const validatedSeed = validateSeed(seed);
  const chunk = createChunkCoordinate(coordinate);
  return Object.freeze({
    seed: validatedSeed,
    coordinate: chunk,
    signal,
    random: createSeededChunkRandom(validatedSeed, chunk),
  });
}
