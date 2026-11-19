import { createChunkCoordinate, type ChunkCoordinate3, CHUNK_CELL_COUNT } from '@engine/world';

export type VoxelMaterialReference =
  | { readonly kind: 'asset'; readonly assetId: string }
  | { readonly kind: 'builtin'; readonly key: string };

export interface VoxelPaletteEntry {
  readonly material: VoxelMaterialReference;
}

export interface VoxelChunkInput {
  readonly coordinate: ChunkCoordinate3;
  readonly revision?: number;
  readonly palette: readonly VoxelPaletteEntry[];
  readonly cells: Uint16Array;
}

export interface VoxelCellEdit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Zero means empty; positive values are one-based palette indexes. */
  readonly value: number;
}

export interface VoxelCellBounds {
  readonly min: Readonly<{ x: number; y: number; z: number }>;
  readonly max: Readonly<{ x: number; y: number; z: number }>;
}

export interface VoxelEditResult {
  readonly snapshot: VoxelChunkSnapshot;
  readonly changedBounds: VoxelCellBounds | null;
}

export type VoxelChunkErrorCode =
  | 'INVALID_CHUNK_REVISION'
  | 'INVALID_CELL_BUFFER'
  | 'INVALID_PALETTE'
  | 'DUPLICATE_PALETTE_MATERIAL'
  | 'INVALID_CELL_VALUE'
  | 'INVALID_CELL_COORDINATE'
  | 'REVISION_OVERFLOW';

export class VoxelChunkError extends Error {
  constructor(
    readonly code: VoxelChunkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VoxelChunkError';
  }
}

function materialKey(reference: VoxelMaterialReference): string {
  if (reference.kind === 'asset') {
    if (!reference.assetId.trim()) {
      throw new VoxelChunkError('INVALID_PALETTE', 'Asset material reference must not be empty');
    }
    return `asset:${reference.assetId}`;
  }
  if (reference.kind === 'builtin') {
    if (!reference.key.trim()) {
      throw new VoxelChunkError('INVALID_PALETTE', 'Built-in material key must not be empty');
    }
    return `builtin:${reference.key}`;
  }
  throw new VoxelChunkError('INVALID_PALETTE', 'Unknown material reference kind');
}

function freezePalette(palette: readonly VoxelPaletteEntry[]): readonly VoxelPaletteEntry[] {
  if (!Array.isArray(palette) || palette.length > 65_535) {
    throw new VoxelChunkError('INVALID_PALETTE', 'Palette must contain at most 65,535 entries');
  }
  const seen = new Set<string>();
  return Object.freeze(
    palette.map((entry) => {
      if (!entry || !entry.material) {
        throw new VoxelChunkError('INVALID_PALETTE', 'Every palette entry needs a material');
      }
      const key = materialKey(entry.material);
      if (seen.has(key)) {
        throw new VoxelChunkError(
          'DUPLICATE_PALETTE_MATERIAL',
          `Duplicate palette material: ${key}`,
        );
      }
      seen.add(key);
      return Object.freeze({ material: Object.freeze({ ...entry.material }) });
    }),
  );
}

function cellIndex(x: number, y: number, z: number): number {
  if (![x, y, z].every((value) => Number.isSafeInteger(value) && value >= 0 && value < 16)) {
    throw new VoxelChunkError(
      'INVALID_CELL_COORDINATE',
      'Cell coordinates must be safe integers in the range 0..15',
    );
  }
  return x + 16 * (y + 16 * z);
}

function validateCells(cells: Uint16Array, paletteLength: number): Uint16Array {
  if (!(cells instanceof Uint16Array) || cells.length !== CHUNK_CELL_COUNT) {
    throw new VoxelChunkError(
      'INVALID_CELL_BUFFER',
      `Cell buffer must be Uint16Array with exactly ${CHUNK_CELL_COUNT} entries`,
    );
  }
  const owned = cells.slice();
  for (let index = 0; index < owned.length; index++) {
    if (owned[index]! > paletteLength) {
      throw new VoxelChunkError(
        'INVALID_CELL_VALUE',
        `Cell ${index} references palette entry ${owned[index]} but palette length is ${paletteLength}`,
      );
    }
  }
  return owned;
}

/** Immutable, revisioned snapshot. Mutable typed-array storage is never exposed. */
export class VoxelChunkSnapshot {
  readonly coordinate: ChunkCoordinate3;
  readonly revision: number;
  readonly palette: readonly VoxelPaletteEntry[];
  readonly #cells: Uint16Array;

  private constructor(
    coordinate: ChunkCoordinate3,
    revision: number,
    palette: readonly VoxelPaletteEntry[],
    cells: Uint16Array,
  ) {
    this.coordinate = coordinate;
    this.revision = revision;
    this.palette = palette;
    this.#cells = cells;
    Object.freeze(this);
  }

  static create(input: VoxelChunkInput): VoxelChunkSnapshot {
    const revision = input.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new VoxelChunkError(
        'INVALID_CHUNK_REVISION',
        'Chunk revision must be a non-negative safe integer',
      );
    }
    const coordinate = createChunkCoordinate(input.coordinate);
    const palette = freezePalette(input.palette);
    const cells = validateCells(input.cells, palette.length);
    return new VoxelChunkSnapshot(coordinate, revision, palette, cells);
  }

  getCell(x: number, y: number, z: number): number {
    return this.#cells[cellIndex(x, y, z)]!;
  }

  /** Returns a detached copy; callers cannot mutate this snapshot's cell storage. */
  copyCells(): Uint16Array {
    return this.#cells.slice();
  }

  withEdits(edits: readonly VoxelCellEdit[]): VoxelEditResult {
    const nextCells = this.#cells.slice();
    let minX = 16,
      minY = 16,
      minZ = 16;
    let maxX = -1,
      maxY = -1,
      maxZ = -1;
    for (const edit of edits) {
      const index = cellIndex(edit.x, edit.y, edit.z);
      if (!Number.isSafeInteger(edit.value) || edit.value < 0 || edit.value > this.palette.length) {
        throw new VoxelChunkError(
          'INVALID_CELL_VALUE',
          `Cell value must be between 0 and palette length ${this.palette.length}`,
        );
      }
      if (nextCells[index] === edit.value) continue;
      nextCells[index] = edit.value;
      minX = Math.min(minX, edit.x);
      minY = Math.min(minY, edit.y);
      minZ = Math.min(minZ, edit.z);
      maxX = Math.max(maxX, edit.x);
      maxY = Math.max(maxY, edit.y);
      maxZ = Math.max(maxZ, edit.z);
    }
    if (maxX < 0) return { snapshot: this, changedBounds: null };
    if (this.revision === Number.MAX_SAFE_INTEGER) {
      throw new VoxelChunkError('REVISION_OVERFLOW', 'Chunk revision cannot be incremented safely');
    }
    return {
      snapshot: new VoxelChunkSnapshot(this.coordinate, this.revision + 1, this.palette, nextCells),
      changedBounds: Object.freeze({
        min: Object.freeze({ x: minX, y: minY, z: minZ }),
        max: Object.freeze({ x: maxX, y: maxY, z: maxZ }),
      }),
    };
  }
}

export function createVoxelChunkSnapshot(input: VoxelChunkInput): VoxelChunkSnapshot {
  return VoxelChunkSnapshot.create(input);
}

export function editVoxelChunk(
  snapshot: VoxelChunkSnapshot,
  edits: readonly VoxelCellEdit[],
): VoxelEditResult {
  return snapshot.withEdits(edits);
}

export {
  isVoxelMeshResultCurrent,
  meshVoxelChunk,
  meshVoxelChunkAsync,
  VoxelMeshingError,
  type VoxelChunkNeighbors,
  type VoxelFaceDirection,
  type VoxelMeshPart,
  type VoxelMeshResult,
  type VoxelMeshingErrorCode,
  type VoxelNeighborRevision,
} from './meshing.js';
