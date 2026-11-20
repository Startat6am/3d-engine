import { describe, expect, it } from 'vitest';
import { createChunkCoordinate } from '@engine/world';
import { createVoxelChunkSnapshot } from './index.js';
import { createVoxelChunkCollisionMesh, VoxelCollisionMeshError } from './collision.js';

function chunk(x: number, cells: readonly [number, number, number, number][]) {
  const buffer = new Uint16Array(16 * 16 * 16);
  for (const [cx, cy, cz, value] of cells) buffer[(cz * 16 + cy) * 16 + cx] = value;
  return createVoxelChunkSnapshot({
    coordinate: createChunkCoordinate({ x, y: 0, z: 0 }),
    palette: [
      { material: { kind: 'builtin', key: 'stone' } },
      { material: { kind: 'builtin', key: 'dirt' } },
    ],
    cells: buffer,
  });
}

describe('voxel static collision mesh', () => {
  it('builds chunk-local exposed triangles with source revision metadata', () => {
    const result = createVoxelChunkCollisionMesh(chunk(0, [[1, 2, 3, 1]]));
    expect(result.sourceRevision).toBe(0);
    expect(result.provisional).toBe(false);
    expect(result.geometry?.positions).toHaveLength(72);
    expect(result.geometry?.indices).toHaveLength(36);
    for (let index = 0; index < result.geometry!.positions.length; index += 3) {
      expect(result.geometry!.positions[index]).toBeGreaterThanOrEqual(1);
      expect(result.geometry!.positions[index]).toBeLessThanOrEqual(2);
      expect(result.geometry!.positions[index + 1]).toBeGreaterThanOrEqual(2);
      expect(result.geometry!.positions[index + 1]).toBeLessThanOrEqual(3);
      expect(result.geometry!.positions[index + 2]).toBeGreaterThanOrEqual(3);
      expect(result.geometry!.positions[index + 2]).toBeLessThanOrEqual(4);
    }
  });

  it('merges material parts and offsets indices without changing chunk-local positions', () => {
    const result = createVoxelChunkCollisionMesh(
      chunk(0, [
        [0, 0, 0, 1],
        [3, 0, 0, 2],
      ]),
    );
    expect(result.geometry?.positions).toHaveLength(144);
    expect(result.geometry?.indices).toHaveLength(72);
    expect(Math.max(...result.geometry!.indices)).toBe(47);
  });

  it('removes the shared boundary when a neighboring chunk is available', () => {
    const source = chunk(0, [[15, 0, 0, 1]]);
    const neighbor = chunk(1, [[0, 0, 0, 1]]);
    const result = createVoxelChunkCollisionMesh(source, { positiveX: neighbor });
    expect(result.geometry?.indices).toHaveLength(30);
    expect(result.neighborRevisions.find((item) => item.direction === 'positiveX')?.revision).toBe(
      0,
    );
  });

  it('returns no geometry for an empty chunk', () => {
    expect(createVoxelChunkCollisionMesh(chunk(0, [])).geometry).toBeNull();
  });

  it('rejects geometry above the physics allocation budget before collider creation', () => {
    expect(() =>
      createVoxelChunkCollisionMesh(chunk(0, [[0, 0, 0, 1]]), {}, 1, {
        maxVertices: 3,
        maxIndices: 3,
      }),
    ).toThrowError(VoxelCollisionMeshError);
  });

  it('rejects invalid limits', () => {
    expect(() =>
      createVoxelChunkCollisionMesh(chunk(0, []), {}, 1, {
        maxVertices: 0,
        maxIndices: 3,
      }),
    ).toThrowError(/safe integers/);
  });
});
