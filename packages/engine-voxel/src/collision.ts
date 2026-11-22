import type { VoxelChunkNeighbors, VoxelNeighborRevision } from './meshing.js';
import { isVoxelMeshResultCurrent, meshVoxelChunk } from './meshing.js';
import type { VoxelChunkSnapshot } from './index.js';

/** Defaults mirror @engine/physics DEFAULT_PHYSICS_RESOURCE_LIMITS. */
export interface VoxelCollisionMeshLimits {
  readonly maxVertices: number;
  readonly maxIndices: number;
}

export const DEFAULT_VOXEL_COLLISION_MESH_LIMITS: VoxelCollisionMeshLimits = Object.freeze({
  maxVertices: 65_536,
  maxIndices: 196_608,
});

export interface VoxelCollisionGeometry {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface VoxelChunkCollisionMesh {
  readonly sourceCoordinate: VoxelChunkSnapshot['coordinate'];
  readonly sourceRevision: number;
  readonly neighborRevisions: readonly VoxelNeighborRevision[];
  readonly provisional: boolean;
  /** Null when the chunk has no occupied cells. Positions are chunk-local. */
  readonly geometry: VoxelCollisionGeometry | null;
}

/** Returns false when the source chunk or any neighbor token has changed. */
export function isVoxelChunkCollisionMeshCurrent(
  result: VoxelChunkCollisionMesh,
  source: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors = {},
): boolean {
  return isVoxelMeshResultCurrent(
    {
      sourceCoordinate: result.sourceCoordinate,
      sourceRevision: result.sourceRevision,
      parts: [],
      neighborRevisions: result.neighborRevisions,
      provisional: result.provisional,
    },
    source,
    neighbors,
  );
}

export class VoxelCollisionMeshError extends Error {
  constructor(
    readonly code: 'INVALID_LIMIT' | 'RESOURCE_LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'VoxelCollisionMeshError';
  }
}

/**
 * Build one bounded, chunk-local triangle mesh for a static physics collider.
 * The caller owns collider creation/removal and must discard results whose source
 * or neighbor revisions are no longer current.
 */
export function createVoxelChunkCollisionMesh(
  snapshot: VoxelChunkSnapshot,
  neighbors: VoxelChunkNeighbors = {},
  voxelSize = 1,
  limits: VoxelCollisionMeshLimits = DEFAULT_VOXEL_COLLISION_MESH_LIMITS,
): VoxelChunkCollisionMesh {
  if (
    !Number.isSafeInteger(limits.maxVertices) ||
    limits.maxVertices < 3 ||
    !Number.isSafeInteger(limits.maxIndices) ||
    limits.maxIndices < 3
  ) {
    throw new VoxelCollisionMeshError(
      'INVALID_LIMIT',
      'Collision mesh limits must be safe integers of at least 3',
    );
  }

  const mesh = meshVoxelChunk(snapshot, neighbors, voxelSize);
  const vertexCount = mesh.parts.reduce(
    (total, part) => total + part.geometry.positions.length / 3,
    0,
  );
  const indexCount = mesh.parts.reduce((total, part) => total + part.geometry.indices.length, 0);
  if (vertexCount > limits.maxVertices || indexCount > limits.maxIndices) {
    throw new VoxelCollisionMeshError(
      'RESOURCE_LIMIT',
      `Voxel collision mesh exceeds limits (vertices=${vertexCount}/${limits.maxVertices}, indices=${indexCount}/${limits.maxIndices})`,
    );
  }

  if (vertexCount === 0) {
    return {
      sourceCoordinate: mesh.sourceCoordinate,
      sourceRevision: mesh.sourceRevision,
      neighborRevisions: mesh.neighborRevisions,
      provisional: mesh.provisional,
      geometry: null,
    };
  }

  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of mesh.parts) {
    positions.set(part.geometry.positions, vertexOffset * 3);
    for (let index = 0; index < part.geometry.indices.length; index++) {
      indices[indexOffset + index] = part.geometry.indices[index]! + vertexOffset;
    }
    vertexOffset += part.geometry.positions.length / 3;
    indexOffset += part.geometry.indices.length;
  }

  return {
    sourceCoordinate: mesh.sourceCoordinate,
    sourceRevision: mesh.sourceRevision,
    neighborRevisions: mesh.neighborRevisions,
    provisional: mesh.provisional,
    geometry: { positions, indices },
  };
}
