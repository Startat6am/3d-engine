import { describe, expect, it, vi } from 'vitest';
import { WorldChunkScheduler, type WorldChunkJobResult } from '@engine/world';
import {
  createVoxelChunkSnapshot,
  editVoxelChunk,
  meshVoxelChunkAsync,
  type VoxelChunkSnapshot,
  type VoxelMeshResult,
} from './index.js';

interface ResidentChunk {
  readonly snapshot: VoxelChunkSnapshot;
  readonly mesh: VoxelMeshResult;
}

const limits = {
  maxConcurrentJobs: 1,
  maxQueuedJobs: 2,
  maxResidentChunks: 1,
  maxChunkPayloadBytes: 8192,
};
const palette = [{ material: { kind: 'builtin' as const, key: 'stone' } }];

function emptyChunk(x: number): VoxelChunkSnapshot {
  return createVoxelChunkSnapshot({
    coordinate: { x, y: 0, z: 0 },
    palette,
    cells: new Uint16Array(4096),
  });
}

function faceCount(mesh: VoxelMeshResult): number {
  return mesh.parts.reduce((total, part) => total + part.geometry.indices.length / 6, 0);
}

async function loadEditAndMesh(
  source: VoxelChunkSnapshot,
  signal: AbortSignal,
): Promise<WorldChunkJobResult<ResidentChunk>> {
  const edited = editVoxelChunk(source, [{ x: 4, y: 5, z: 6, value: 1 }]).snapshot;
  const mesh = await meshVoxelChunkAsync(edited, {}, 1, signal);
  return {
    value: { snapshot: edited, mesh },
    byteLength: edited.copyCells().byteLength,
  };
}

describe('voxel world lifecycle integration', () => {
  it('loads, edits, meshes, evicts and disposes resident voxel chunks', async () => {
    const released: ResidentChunk[] = [];
    const release = vi.fn((resident: ResidentChunk) => released.push(resident));
    const scheduler = new WorldChunkScheduler<ResidentChunk>({ limits, releaseResident: release });

    const first = await scheduler.request({
      coordinate: { x: 0, y: 0, z: 0 },
      revision: 1,
      run: (signal) => loadEditAndMesh(emptyChunk(0), signal),
    });

    expect(first.snapshot.revision).toBe(1);
    expect(first.snapshot.getCell(4, 5, 6)).toBe(1);
    expect(faceCount(first.mesh)).toBe(6);
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })?.value).toBe(first);

    expect(scheduler.evict({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(scheduler.evict({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })).toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(released[0]).toBe(first);

    const second = await scheduler.request({
      coordinate: { x: 1, y: 0, z: 0 },
      revision: 1,
      run: (signal) => loadEditAndMesh(emptyChunk(1), signal),
    });
    expect(second.mesh.parts).toHaveLength(1);
    scheduler.dispose();
    scheduler.dispose();

    expect(scheduler.isDisposed).toBe(true);
    expect(scheduler.residentCount).toBe(0);
    expect(release).toHaveBeenCalledTimes(2);
    expect(released[1]).toBe(second);
    await expect(
      scheduler.request({
        coordinate: { x: 2, y: 0, z: 0 },
        revision: 1,
        run: async () => ({ value: second, byteLength: 0 }),
      }),
    ).rejects.toMatchObject({ code: 'WORLD_DISPOSED' });
  });
});
