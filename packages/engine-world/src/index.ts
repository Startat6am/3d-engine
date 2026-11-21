export const DEFAULT_CHUNK_DIMENSIONS: ChunkDimensions3 = Object.freeze({ x: 16, y: 16, z: 16 });
export const DEFAULT_WORLD_VOXEL_SIZE = 1;
export const CHUNK_CELL_COUNT = 16 * 16 * 16;

export interface WorldSettings {
  readonly voxelSize: number;
  readonly chunkDimensions: ChunkDimensions3;
}

export function createWorldSettings(voxelSize = DEFAULT_WORLD_VOXEL_SIZE): WorldSettings {
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new WorldCoordinateError(
      'INVALID_WORLD_SETTINGS',
      'World voxel size must be a finite positive number',
    );
  }
  return Object.freeze({ voxelSize, chunkDimensions: DEFAULT_CHUNK_DIMENSIONS });
}

export interface WorldPoint3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkDimensions3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkCoordinate3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CellCoordinate3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkAddress3 {
  readonly chunk: ChunkCoordinate3;
  readonly cell: CellCoordinate3;
  readonly globalCell: CellCoordinate3;
}

export type WorldCoordinateErrorCode =
  | 'INVALID_WORLD_SETTINGS'
  | 'INVALID_VOXEL_SIZE'
  | 'INVALID_CHUNK_DIMENSIONS'
  | 'NON_FINITE_WORLD_POSITION'
  | 'COORDINATE_OUT_OF_RANGE'
  | 'INVALID_CHUNK_COORDINATE'
  | 'INVALID_CHUNK_KEY';

export class WorldCoordinateError extends Error {
  constructor(
    readonly code: WorldCoordinateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldCoordinateError';
  }
}

/** Validate and freeze a signed integer chunk coordinate. */
export function createChunkCoordinate(value: ChunkCoordinate3): ChunkCoordinate3 {
  if (![value.x, value.y, value.z].every(Number.isSafeInteger)) {
    throw new WorldCoordinateError(
      'INVALID_CHUNK_COORDINATE',
      'Chunk coordinates must be safe integers',
    );
  }
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

/** Stable, locale-independent key for a chunk coordinate. */
export function chunkCoordinateKey(value: ChunkCoordinate3): string {
  const coordinate = createChunkCoordinate(value);
  return `${coordinate.x},${coordinate.y},${coordinate.z}`;
}

/** Parse only canonical decimal integer triples emitted by chunkCoordinateKey. */
export function parseChunkCoordinateKey(key: string): ChunkCoordinate3 {
  const match = /^(0|-?[1-9]\d*),(0|-?[1-9]\d*),(0|-?[1-9]\d*)$/.exec(key);
  if (!match) {
    throw new WorldCoordinateError(
      'INVALID_CHUNK_KEY',
      'Chunk key must be a canonical x,y,z triple',
    );
  }
  const coordinate = {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
  return createChunkCoordinate(coordinate);
}

/**
 * Map a world-space point to its owning chunk and local cell.
 * World units are meters. Partitioning uses floor semantics, including for
 * negative coordinates and points exactly on chunk boundaries.
 */
export function worldPointToChunkAddress(
  position: WorldPoint3,
  voxelSize: number,
  chunkDimensions: ChunkDimensions3,
): ChunkAddress3 {
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new WorldCoordinateError(
      'INVALID_VOXEL_SIZE',
      'Voxel size must be a finite positive number',
    );
  }
  validateChunkDimensions(chunkDimensions);
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new WorldCoordinateError(
      'NON_FINITE_WORLD_POSITION',
      'World position components must be finite numbers',
    );
  }

  const globalCell = {
    x: Math.floor(position.x / voxelSize),
    y: Math.floor(position.y / voxelSize),
    z: Math.floor(position.z / voxelSize),
  };
  if (![globalCell.x, globalCell.y, globalCell.z].every(Number.isSafeInteger)) {
    throw new WorldCoordinateError(
      'COORDINATE_OUT_OF_RANGE',
      'World position maps outside the safe integer cell-coordinate range',
    );
  }

  const chunk = createChunkCoordinate({
    x: Math.floor(globalCell.x / chunkDimensions.x),
    y: Math.floor(globalCell.y / chunkDimensions.y),
    z: Math.floor(globalCell.z / chunkDimensions.z),
  });
  const cell = Object.freeze({
    x: globalCell.x - chunk.x * chunkDimensions.x,
    y: globalCell.y - chunk.y * chunkDimensions.y,
    z: globalCell.z - chunk.z * chunkDimensions.z,
  });
  return Object.freeze({
    chunk,
    cell,
    globalCell: Object.freeze(globalCell),
  });
}

function validateChunkDimensions(dimensions: ChunkDimensions3): void {
  if (
    ![dimensions.x, dimensions.y, dimensions.z].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    throw new WorldCoordinateError(
      'INVALID_CHUNK_DIMENSIONS',
      'Chunk dimensions must be positive safe integers',
    );
  }
}

export {
  WorldChunkScheduler,
  WorldStreamingError,
  type WorldChunkJobRequest,
  type WorldChunkJobResult,
  type WorldChunkResident,
  type WorldChunkSchedulerOptions,
  type WorldStreamingErrorCode,
  type WorldStreamingLimits,
} from './streaming.js';

export {
  createChunkGenerationContext,
  createSeededChunkRandom,
  WorldGenerationError,
  type WorldChunkGenerationContext,
  type WorldChunkGenerator,
  type WorldGenerationErrorCode,
  type WorldSeed,
} from './generation.js';
