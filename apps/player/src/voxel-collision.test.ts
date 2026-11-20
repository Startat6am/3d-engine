import { describe, expect, it } from 'vitest';
import { createVoxelChunkSnapshot } from '@engine/voxel';
import { createVoxelChunkColliderInputs } from './voxel-collision.js';

function chunk(x: number, revision = 1) {
  const cells = new Uint16Array(16 * 16 * 16);
  cells[x === 0 ? 15 : 0] = 1;
  return createVoxelChunkSnapshot({
    coordinate: { x, y: 0, z: 0 } as Parameters<typeof createVoxelChunkSnapshot>[0]['coordinate'],
    revision,
    palette: [{ material: { kind: 'builtin', key: 'stone' } }],
    cells,
  });
}

describe('createVoxelChunkColliderInputs', () => {
  it('builds chunk-local triangle meshes at world-space chunk origins', () => {
    const inputs = createVoxelChunkColliderInputs([chunk(0), chunk(2)], 0.5);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.key).toBe('0,0,0');
    expect(inputs[0]?.position).toEqual([0, 0, 0]);
    expect(inputs[1]?.position).toEqual([16, 0, 0]);
    expect(inputs[0]?.vertices.length).toBeGreaterThan(0);
    const indices = inputs[0]?.indices;
    expect(indices).toBeDefined();
    expect(indices?.length).toBeGreaterThan(0);
    expect(indices ? indices.length % 3 : -1).toBe(0);
  });

  it('includes neighbor revisions in collider tokens and removes internal shared faces', () => {
    const isolated = createVoxelChunkColliderInputs([chunk(0)])[0]!;
    const adjacent = createVoxelChunkColliderInputs([chunk(0), chunk(1)])[0]!;
    expect(adjacent.revision).not.toBe(isolated.revision);
    expect(adjacent.indices.length).toBeLessThan(isolated.indices.length);
  });

  it('changes collider tokens when a neighboring chunk revision changes', () => {
    const first = createVoxelChunkColliderInputs([chunk(0), chunk(1, 1)])[0]!;
    const second = createVoxelChunkColliderInputs([chunk(0), chunk(1, 2)])[0]!;
    expect(second.revision).not.toBe(first.revision);
  });

  it('rejects duplicate coordinates and invalid voxel sizes', () => {
    expect(() => createVoxelChunkColliderInputs([chunk(0), chunk(0, 2)])).toThrow(
      'Duplicate voxel chunk coordinate',
    );
    expect(() => createVoxelChunkColliderInputs([chunk(0)], 0)).toThrow(
      'finite positive number',
    );
  });
});
