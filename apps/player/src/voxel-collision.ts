import type { EntityId } from '@engine/core';
import { StaticMeshColliderSet } from '@engine/physics';
import { DEFAULT_CHUNK_DIMENSIONS } from '@engine/world';
import {
  createVoxelChunkCollisionMesh,
  isVoxelChunkCollisionMeshCurrent,
  type VoxelChunkNeighbors,
  type VoxelChunkSnapshot,
} from '@engine/voxel';

function chunkKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Build physics-ready chunk colliders, including all six neighbor revision tokens. */
export function createVoxelChunkColliderInputs(
  chunks: readonly VoxelChunkSnapshot[],
  voxelSize = 1,
) {
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new RangeError('Voxel collision size must be a finite positive number');
  }

  const byCoordinate = new Map<string, VoxelChunkSnapshot>();
  for (const chunk of chunks) {
    const { x, y, z } = chunk.coordinate;
    const key = chunkKey(x, y, z);
    if (byCoordinate.has(key)) throw new Error(`Duplicate voxel chunk coordinate: ${key}`);
    byCoordinate.set(key, chunk);
  }

  const inputs = [];
  for (const chunk of chunks) {
    const { x, y, z } = chunk.coordinate;
    const neighbor = (dx: number, dy: number, dz: number) =>
      byCoordinate.get(chunkKey(x + dx, y + dy, z + dz));
    const positiveX = neighbor(1, 0, 0);
    const negativeX = neighbor(-1, 0, 0);
    const positiveY = neighbor(0, 1, 0);
    const negativeY = neighbor(0, -1, 0);
    const positiveZ = neighbor(0, 0, 1);
    const negativeZ = neighbor(0, 0, -1);
    const neighbors: VoxelChunkNeighbors = {
      ...(positiveX ? { positiveX } : {}),
      ...(negativeX ? { negativeX } : {}),
      ...(positiveY ? { positiveY } : {}),
      ...(negativeY ? { negativeY } : {}),
      ...(positiveZ ? { positiveZ } : {}),
      ...(negativeZ ? { negativeZ } : {}),
    };
    const mesh = createVoxelChunkCollisionMesh(chunk, neighbors, voxelSize);
    if (!isVoxelChunkCollisionMeshCurrent(mesh, chunk, neighbors) || !mesh.geometry) continue;

    const key = chunkKey(x, y, z);
    inputs.push({
      key,
      entity: `voxel-chunk:${key}` as EntityId,
      revision: JSON.stringify([mesh.sourceRevision, mesh.neighborRevisions]),
      position: [
        x * DEFAULT_CHUNK_DIMENSIONS.x * voxelSize,
        y * DEFAULT_CHUNK_DIMENSIONS.y * voxelSize,
        z * DEFAULT_CHUNK_DIMENSIONS.z * voxelSize,
      ] as const,
      vertices: mesh.geometry.positions,
      indices: mesh.geometry.indices,
    });
  }
  return inputs;
}

/** Synchronize a live physics world's static chunk colliders with current snapshots. */
export function syncVoxelChunkColliders(
  colliderSet: StaticMeshColliderSet,
  chunks: readonly VoxelChunkSnapshot[],
  voxelSize = 1,
): number {
  const inputs = createVoxelChunkColliderInputs(chunks, voxelSize);
  colliderSet.sync(inputs);
  return inputs.length;
}
