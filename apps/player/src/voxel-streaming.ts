import { createChunkCoordinate, type ChunkCoordinate3, type ChunkDimensions3 } from '@engine/world';

export interface VoxelStreamingCandidate<T> {
  readonly coordinate: ChunkCoordinate3;
  readonly value: T;
}

export interface VoxelStreamingWindow<T> extends VoxelStreamingCandidate<T> {
  /** Squared chunk-grid distance from the camera chunk; lower is higher priority. */
  readonly distanceSquared: number;
}

/** Select a bounded, deterministic chunk window around a world-space camera position. */
export function selectVoxelStreamingWindow<T>(
  candidates: readonly VoxelStreamingCandidate<T>[],
  cameraPosition: readonly [number, number, number],
  voxelSize: number,
  chunkDimensions: ChunkDimensions3,
  radius: number,
  verticalRadius = radius,
): readonly VoxelStreamingWindow<T>[] {
  if (!cameraPosition.every(Number.isFinite)) {
    throw new RangeError('Camera position must contain finite coordinates');
  }
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new RangeError('Voxel size must be finite and positive');
  }
  if (
    ![chunkDimensions.x, chunkDimensions.y, chunkDimensions.z].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    throw new RangeError('Chunk dimensions must be positive safe integers');
  }
  if (
    !Number.isSafeInteger(radius) ||
    radius < 0 ||
    !Number.isSafeInteger(verticalRadius) ||
    verticalRadius < 0
  ) {
    throw new RangeError('Streaming radii must be non-negative safe integers');
  }
  const chunkWorldSize = [
    chunkDimensions.x * voxelSize,
    chunkDimensions.y * voxelSize,
    chunkDimensions.z * voxelSize,
  ] as const;
  const center = createChunkCoordinate({
    x: Math.floor(cameraPosition[0] / chunkWorldSize[0]),
    y: Math.floor(cameraPosition[1] / chunkWorldSize[1]),
    z: Math.floor(cameraPosition[2] / chunkWorldSize[2]),
  });
  const seen = new Set<string>();
  const selected: VoxelStreamingWindow<T>[] = [];
  for (const candidate of candidates) {
    const coordinate = createChunkCoordinate(candidate.coordinate);
    const key = `${coordinate.x},${coordinate.y},${coordinate.z}`;
    if (seen.has(key)) throw new Error(`Duplicate voxel streaming coordinate: ${key}`);
    seen.add(key);
    const dx = coordinate.x - center.x;
    const dy = coordinate.y - center.y;
    const dz = coordinate.z - center.z;
    if (Math.abs(dx) > radius || Math.abs(dy) > verticalRadius || Math.abs(dz) > radius) continue;
    selected.push({ ...candidate, coordinate, distanceSquared: dx * dx + dy * dy + dz * dz });
  }
  selected.sort(
    (left, right) =>
      left.distanceSquared - right.distanceSquared ||
      left.coordinate.y - right.coordinate.y ||
      left.coordinate.z - right.coordinate.z ||
      left.coordinate.x - right.coordinate.x,
  );
  return selected;
}
