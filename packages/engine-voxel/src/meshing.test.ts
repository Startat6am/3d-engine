import { describe, expect, it } from 'vitest';
import {
  createVoxelChunkSnapshot,
  isVoxelMeshResultCurrent,
  meshVoxelChunk,
  VoxelMeshingError,
  type VoxelPaletteEntry,
} from './index.js';

const stonePalette = [{ material: { kind: 'builtin' as const, key: 'stone' } }];
const coordinate = { x: 0, y: 0, z: 0 };

function cellsWith(entries: readonly { x: number; y: number; z: number; value: number }[]) {
  const cells = new Uint16Array(4096);
  for (const entry of entries) {
    cells[entry.x + 16 * (entry.y + 16 * entry.z)] = entry.value;
  }
  return cells;
}

function snapshot(
  chunkCoordinate = coordinate,
  entries: readonly { x: number; y: number; z: number; value: number }[] = [],
  palette: readonly VoxelPaletteEntry[] = stonePalette,
  revision = 0,
) {
  return createVoxelChunkSnapshot({
    coordinate: chunkCoordinate,
    palette,
    cells: cellsWith(entries),
    revision,
  });
}

function faceCount(result: ReturnType<typeof meshVoxelChunk>): number {
  return result.parts.reduce((total, part) => total + part.geometry.indices.length / 6, 0);
}

describe('voxel CPU meshing', () => {
  it('returns no mesh buffers for an empty chunk', () => {
    const result = meshVoxelChunk(snapshot());
    expect(result.parts).toEqual([]);
    expect(result.provisional).toBe(false);
    expect(result.neighborRevisions).toHaveLength(6);
  });

  it('emits six outward faces for one voxel and applies voxel scale', () => {
    const result = meshVoxelChunk(snapshot(coordinate, [{ x: 8, y: 8, z: 8, value: 1 }]), {}, 0.5);
    const geometry = result.parts[0]!.geometry;
    expect(faceCount(result)).toBe(6);
    expect(geometry.positions).toHaveLength(72);
    expect(geometry.normals).toHaveLength(72);
    expect(geometry.uvs).toHaveLength(48);
    expect(geometry.indices).toHaveLength(36);
    expect(Math.min(...geometry.positions)).toBe(4);
    expect(Math.max(...geometry.positions)).toBe(4.5);
    expect(result.provisional).toBe(false);
  });

  it('uses consistent outward winding for all six face directions', () => {
    const geometry = meshVoxelChunk(snapshot(coordinate, [{ x: 8, y: 8, z: 8, value: 1 }]))
      .parts[0]!.geometry;
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const a = geometry.indices[index]! * 3;
      const b = geometry.indices[index + 1]! * 3;
      const c = geometry.indices[index + 2]! * 3;
      const ab = [
        geometry.positions[b]! - geometry.positions[a]!,
        geometry.positions[b + 1]! - geometry.positions[a + 1]!,
        geometry.positions[b + 2]! - geometry.positions[a + 2]!,
      ];
      const ac = [
        geometry.positions[c]! - geometry.positions[a]!,
        geometry.positions[c + 1]! - geometry.positions[a + 1]!,
        geometry.positions[c + 2]! - geometry.positions[a + 2]!,
      ];
      const normal = [geometry.normals[a]!, geometry.normals[a + 1]!, geometry.normals[a + 2]!];
      const cross = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ];
      expect(
        cross[0]! * normal[0]! + cross[1]! * normal[1]! + cross[2]! * normal[2]!,
      ).toBeGreaterThan(0);
    }
  });

  it('culls shared faces between adjacent cells in one chunk', () => {
    const result = meshVoxelChunk(
      snapshot(coordinate, [
        { x: 1, y: 8, z: 8, value: 1 },
        { x: 2, y: 8, z: 8, value: 1 },
      ]),
    );
    expect(faceCount(result)).toBe(10);
  });

  it('splits geometry into deterministic palette-index parts', () => {
    const palette = [
      { material: { kind: 'builtin' as const, key: 'stone' } },
      { material: { kind: 'asset' as const, assetId: 'mat:grass' } },
    ];
    const result = meshVoxelChunk(
      snapshot(
        coordinate,
        [
          { x: 1, y: 8, z: 8, value: 2 },
          { x: 2, y: 8, z: 8, value: 1 },
        ],
        palette,
      ),
    );
    expect(result.parts.map((part) => part.paletteIndex)).toEqual([1, 2]);
    expect(result.parts[0]!.material).toEqual(palette[0]!.material);
    expect(result.parts[1]!.material).toEqual(palette[1]!.material);
  });

  it('culls faces against a loaded adjacent chunk and records its revision', () => {
    const source = snapshot(coordinate, [{ x: 15, y: 8, z: 8, value: 1 }]);
    const positiveX = snapshot({ x: 1, y: 0, z: 0 }, [{ x: 0, y: 8, z: 8, value: 1 }]);
    const result = meshVoxelChunk(source, { positiveX });
    expect(faceCount(result)).toBe(5);
    expect(result.provisional).toBe(false);
    expect(result.neighborRevisions.find((item) => item.direction === 'positiveX')).toEqual({
      direction: 'positiveX',
      revision: positiveX.revision,
    });
  });

  it('marks boundary faces provisional when a neighbor is unavailable', () => {
    const result = meshVoxelChunk(snapshot(coordinate, [{ x: 0, y: 8, z: 8, value: 1 }]));
    expect(faceCount(result)).toBe(6);
    expect(result.provisional).toBe(true);
    expect(result.neighborRevisions.find((item) => item.direction === 'negativeX')).toEqual({
      direction: 'negativeX',
      revision: null,
    });
  });

  it('rejects a neighbor supplied for the wrong chunk coordinate', () => {
    const source = snapshot(coordinate, [{ x: 15, y: 8, z: 8, value: 1 }]);
    const wrong = snapshot({ x: 2, y: 0, z: 0 });
    expect(() => meshVoxelChunk(source, { positiveX: wrong })).toThrow(VoxelMeshingError);
  });

  it('emits only the six chunk boundary surfaces for a full solid chunk', () => {
    const cells = new Uint16Array(4096).fill(1);
    const full = createVoxelChunkSnapshot({ coordinate, palette: stonePalette, cells });
    const result = meshVoxelChunk(full);
    expect(faceCount(result)).toBe(6 * 16 * 16);
    expect(result.parts[0]!.geometry.indices).toHaveLength(6 * 16 * 16 * 6);
  });

  it('accepts a mesh only while its source and neighbor revision tokens remain current', () => {
    const source = snapshot(coordinate, [{ x: 15, y: 8, z: 8, value: 1 }]);
    const positiveX = snapshot({ x: 1, y: 0, z: 0 }, [{ x: 0, y: 8, z: 8, value: 1 }]);
    const neighbors = { positiveX };
    const result = meshVoxelChunk(source, neighbors);

    expect(isVoxelMeshResultCurrent(result, source, neighbors)).toBe(true);
    expect(
      isVoxelMeshResultCurrent(result, snapshot(coordinate, [], stonePalette, 1), neighbors),
    ).toBe(false);
    expect(isVoxelMeshResultCurrent(result, source, {})).toBe(false);
    expect(
      isVoxelMeshResultCurrent(result, source, {
        positiveX: snapshot({ x: 1, y: 0, z: 0 }, [], stonePalette, 1),
      }),
    ).toBe(false);
    expect(
      isVoxelMeshResultCurrent(result, source, {
        positiveX: snapshot({ x: 2, y: 0, z: 0 }, [], stonePalette),
      }),
    ).toBe(false);
  });

  it('invalidates provisional meshes when a previously missing neighbor arrives', () => {
    const source = snapshot(coordinate, [{ x: 15, y: 8, z: 8, value: 1 }]);
    const provisional = meshVoxelChunk(source);
    const neighbor = snapshot({ x: 1, y: 0, z: 0 });
    expect(isVoxelMeshResultCurrent(provisional, source, { positiveX: neighbor })).toBe(false);
  });

  it('rejects non-finite and non-positive voxel scales', () => {
    const source = snapshot();
    expect(() => meshVoxelChunk(source, {}, 0)).toThrow(VoxelMeshingError);
    expect(() => meshVoxelChunk(source, {}, Number.POSITIVE_INFINITY)).toThrow(VoxelMeshingError);
  });
});
