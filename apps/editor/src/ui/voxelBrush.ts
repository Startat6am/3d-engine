import type { VoxelWorldSettings } from '@engine/project-storage';
import type { VoxelChunkSnapshot } from '@engine/project-storage';
import type { RendererPickHit } from '@engine/renderer/contracts';

export type VoxelBrushMode = 'paint' | 'erase';
export interface VoxelBrushCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Resolve a world-space surface hit to an editable cell in one chunk. */
export function resolveVoxelBrushCell(
  hit: Pick<RendererPickHit, 'point' | 'normal'>,
  chunk: Pick<VoxelChunkSnapshot, 'coordinate'>,
  settings: Pick<VoxelWorldSettings, 'voxelSize' | 'chunkDimensions'>,
  mode: VoxelBrushMode,
): VoxelBrushCell | null {
  const size = settings.voxelSize;
  if (!Number.isFinite(size) || size <= 0) return null;
  const normal = hit.normal.map((value) => Math.round(value));
  if (
    normal.some((value) => !Number.isFinite(value) || Math.abs(value) > 1) ||
    normal.reduce((sum, value) => sum + Math.abs(value), 0) !== 1
  ) {
    return null;
  }
  const origin = [
    chunk.coordinate.x * settings.chunkDimensions.x * size,
    chunk.coordinate.y * settings.chunkDimensions.y * size,
    chunk.coordinate.z * settings.chunkDimensions.z * size,
  ];
  const dimensions = [
    settings.chunkDimensions.x,
    settings.chunkDimensions.y,
    settings.chunkDimensions.z,
  ];
  const cell = hit.point.map((value, axis) => {
    const inside = Math.floor((value - origin[axis]! - normal[axis]! * size * 1e-4) / size);
    return inside + (mode === 'paint' ? normal[axis]! : 0);
  });
  if (
    cell.some((value, axis) => !Number.isInteger(value) || value < 0 || value >= dimensions[axis]!)
  ) {
    return null;
  }
  return { x: cell[0]!, y: cell[1]!, z: cell[2]! };
}
