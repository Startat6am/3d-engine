import type { MeshData } from '@engine/geometry';
import type { ChunkCoordinate3 } from '@engine/world';
import { VoxelChunkError, type VoxelMaterialReference, VoxelChunkSnapshot } from './index.js';

export type VoxelFaceDirection =
  'positiveX' | 'negativeX' | 'positiveY' | 'negativeY' | 'positiveZ' | 'negativeZ';

export interface VoxelChunkNeighbors {
  readonly positiveX?: VoxelChunkSnapshot;
  readonly negativeX?: VoxelChunkSnapshot;
  readonly positiveY?: VoxelChunkSnapshot;
  readonly negativeY?: VoxelChunkSnapshot;
  readonly positiveZ?: VoxelChunkSnapshot;
  readonly negativeZ?: VoxelChunkSnapshot;
}

export interface VoxelNeighborRevision {
  readonly direction: VoxelFaceDirection;
  readonly revision: number | null;
}

export interface VoxelMeshPart {
  /** One-based index into the source chunk palette. */
  readonly paletteIndex: number;
  readonly material: VoxelMaterialReference;
  readonly geometry: MeshData;
}

export interface VoxelMeshResult {
  readonly sourceCoordinate: ChunkCoordinate3;
  readonly sourceRevision: number;
  readonly parts: readonly VoxelMeshPart[];
  readonly neighborRevisions: readonly VoxelNeighborRevision[];
  /** True when emitted boundary faces depend on a currently unavailable neighbor. */
  readonly provisional: boolean;
}

export type VoxelMeshingErrorCode =
  'INVALID_MESH_VOXEL_SIZE' | 'INVALID_NEIGHBOR_COORDINATE' | 'MESHING_ABORTED';

export class VoxelMeshingError extends Error {
  constructor(
    readonly code: VoxelMeshingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VoxelMeshingError';
  }
}

interface FaceDefinition {
  readonly direction: VoxelFaceDirection;
  readonly normal: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
}

const FACES: readonly FaceDefinition[] = [
  {
    direction: 'positiveX',
    normal: [1, 0, 0],
    offset: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    direction: 'negativeX',
    normal: [-1, 0, 0],
    offset: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    direction: 'positiveY',
    normal: [0, 1, 0],
    offset: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    direction: 'negativeY',
    normal: [0, -1, 0],
    offset: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    direction: 'positiveZ',
    normal: [0, 0, 1],
    offset: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    direction: 'negativeZ',
    normal: [0, 0, -1],
    offset: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

const UV_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

interface MutableMeshPart {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

function expectedNeighborCoordinate(
  coordinate: ChunkCoordinate3,
  direction: VoxelFaceDirection,
): ChunkCoordinate3 {
  switch (direction) {
    case 'positiveX':
      return { x: coordinate.x + 1, y: coordinate.y, z: coordinate.z };
    case 'negativeX':
      return { x: coordinate.x - 1, y: coordinate.y, z: coordinate.z };
    case 'positiveY':
      return { x: coordinate.x, y: coordinate.y + 1, z: coordinate.z };
    case 'negativeY':
      return { x: coordinate.x, y: coordinate.y - 1, z: coordinate.z };
    case 'positiveZ':
      return { x: coordinate.x, y: coordinate.y, z: coordinate.z + 1 };
    case 'negativeZ':
      return { x: coordinate.x, y: coordinate.y, z: coordinate.z - 1 };
  }
}

function validateNeighbors(
  coordinate: ChunkCoordinate3,
  neighbors: VoxelChunkNeighbors,
): readonly VoxelNeighborRevision[] {
  return Object.freeze(
    FACES.map((face) => {
      const neighbor = neighbors[face.direction];
      if (!neighbor) return Object.freeze({ direction: face.direction, revision: null });
      const expected = expectedNeighborCoordinate(coordinate, face.direction);
      if (
        ![expected.x, expected.y, expected.z].every(Number.isSafeInteger) ||
        neighbor.coordinate.x !== expected.x ||
        neighbor.coordinate.y !== expected.y ||
        neighbor.coordinate.z !== expected.z
      ) {
        throw new VoxelMeshingError(
          'INVALID_NEIGHBOR_COORDINATE',
          `Neighbor in direction ${face.direction} is not adjacent to the source chunk`,
        );
      }
      return Object.freeze({ direction: face.direction, revision: neighbor.revision });
    }),
  );
}

function neighborCell(
  neighbor: VoxelChunkSnapshot,
  direction: VoxelFaceDirection,
  x: number,
  y: number,
  z: number,
): number {
  switch (direction) {
    case 'positiveX':
      return neighbor.getCell(0, y, z);
    case 'negativeX':
      return neighbor.getCell(15, y, z);
    case 'positiveY':
      return neighbor.getCell(x, 0, z);
    case 'negativeY':
      return neighbor.getCell(x, 15, z);
    case 'positiveZ':
      return neighbor.getCell(x, y, 0);
    case 'negativeZ':
      return neighbor.getCell(x, y, 15);
  }
}

function addFace(
  part: MutableMeshPart,
  x: number,
  y: number,
  z: number,
  voxelSize: number,
  face: FaceDefinition,
): void {
  const base = part.positions.length / 3;
  for (let vertex = 0; vertex < 4; vertex++) {
    const corner = face.corners[vertex]!;
    part.positions.push(
      (x + corner[0]) * voxelSize,
      (y + corner[1]) * voxelSize,
      (z + corner[2]) * voxelSize,
    );
    part.normals.push(...face.normal);
    part.uvs.push(...UV_CORNERS[vertex]!);
  }
  part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Return false when a completed mesh no longer matches its source chunk or any
 * of the six neighbor availability/revision tokens captured during meshing.
 */
export function isVoxelMeshResultCurrent(
  result: VoxelMeshResult,
  source: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors = {},
): boolean {
  if (
    result.sourceCoordinate.x !== source.coordinate.x ||
    result.sourceCoordinate.y !== source.coordinate.y ||
    result.sourceCoordinate.z !== source.coordinate.z ||
    result.sourceRevision !== source.revision
  ) {
    return false;
  }

  try {
    const currentNeighbors = validateNeighbors(source.coordinate, neighbors);
    return result.neighborRevisions.every((dependency) => {
      const current = currentNeighbors.find((item) => item.direction === dependency.direction);
      return current?.revision === dependency.revision;
    });
  } catch {
    return false;
  }
}

interface MutableMeshingState {
  readonly neighborRevisions: readonly VoxelNeighborRevision[];
  readonly mutableParts: Map<number, MutableMeshPart>;
  provisional: boolean;
}

function createMeshingState(
  snapshot: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors,
  voxelSize: number,
): MutableMeshingState {
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new VoxelMeshingError(
      'INVALID_MESH_VOXEL_SIZE',
      'Meshing voxel size must be a finite positive number',
    );
  }
  return {
    neighborRevisions: validateNeighbors(snapshot.coordinate, neighbors),
    mutableParts: new Map(),
    provisional: false,
  };
}

function meshZSlice(
  snapshot: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors,
  voxelSize: number,
  z: number,
  state: MutableMeshingState,
): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const paletteIndex = snapshot.getCell(x, y, z);
      if (paletteIndex === 0) continue;

      for (const face of FACES) {
        const [dx, dy, dz] = face.offset;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        let adjacentValue: number;

        if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16) {
          adjacentValue = snapshot.getCell(nx, ny, nz);
        } else {
          const neighbor = neighbors[face.direction];
          if (!neighbor) {
            adjacentValue = 0;
            state.provisional = true;
          } else {
            adjacentValue = neighborCell(neighbor, face.direction, x, y, z);
          }
        }

        if (adjacentValue !== 0) continue;
        let part = state.mutableParts.get(paletteIndex);
        if (!part) {
          part = { positions: [], normals: [], uvs: [], indices: [] };
          state.mutableParts.set(paletteIndex, part);
        }
        addFace(part, x, y, z, voxelSize, face);
      }
    }
  }
}

function finalizeMeshResult(
  snapshot: VoxelChunkSnapshot,
  state: MutableMeshingState,
): VoxelMeshResult {
  const parts = [...state.mutableParts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([paletteIndex, part]) => {
      const paletteEntry = snapshot.palette[paletteIndex - 1];
      if (!paletteEntry) {
        throw new VoxelChunkError(
          'INVALID_CELL_VALUE',
          `Mesh cell references missing palette entry ${paletteIndex}`,
        );
      }
      return Object.freeze({
        paletteIndex,
        material: paletteEntry.material,
        geometry: Object.freeze({
          positions: new Float32Array(part.positions),
          normals: new Float32Array(part.normals),
          uvs: new Float32Array(part.uvs),
          indices: new Uint32Array(part.indices),
        }),
      });
    });

  return Object.freeze({
    sourceCoordinate: snapshot.coordinate,
    sourceRevision: snapshot.revision,
    parts: Object.freeze(parts),
    neighborRevisions: state.neighborRevisions,
    provisional: state.provisional,
  });
}

function throwIfMeshingAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VoxelMeshingError('MESHING_ABORTED', 'Voxel meshing was cancelled');
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Build deterministic exposed-face geometry from an immutable chunk and its six neighbors. */
export function meshVoxelChunk(
  snapshot: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors = {},
  voxelSize = 1,
): VoxelMeshResult {
  const state = createMeshingState(snapshot, neighbors, voxelSize);
  for (let z = 0; z < 16; z++) {
    meshZSlice(snapshot, neighbors, voxelSize, z, state);
  }
  return finalizeMeshResult(snapshot, state);
}

/**
 * Cooperative async meshing for cancellable jobs. Work yields between z-slices so
 * AbortSignal can be observed; partial geometry stays private and is never returned.
 */
export async function meshVoxelChunkAsync(
  snapshot: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors = {},
  voxelSize = 1,
  signal?: AbortSignal,
): Promise<VoxelMeshResult> {
  throwIfMeshingAborted(signal);
  const state = createMeshingState(snapshot, neighbors, voxelSize);

  for (let z = 0; z < 16; z++) {
    throwIfMeshingAborted(signal);
    meshZSlice(snapshot, neighbors, voxelSize, z, state);
    if (z < 15) {
      await yieldToEventLoop();
    }
  }

  throwIfMeshingAborted(signal);
  return finalizeMeshResult(snapshot, state);
}
