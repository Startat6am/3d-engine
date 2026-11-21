import type { AssetRecord } from '@engine/assets';
import { describe, expect, it } from 'vitest';
import { resolveVoxelMaterialStyle } from './voxel-material.js';

function materialAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 'asset:voxel-material-copper' as AssetRecord['id'],
    name: 'Copper Alloy',
    kind: 'material',
    uri: 'materials/voxel/copper.json',
    contentHash: 'sha256:' + 'a'.repeat(64),
    importer: { id: 'choreon.voxel-material', version: '1', settings: {} },
    dependencies: [],
    metadata: { role: 'voxel-material', color: 0xb87333, roughness: 0.9 },
    ...overrides,
  };
}

describe('Player voxel material resolution', () => {
  it('resolves built-in materials from the shared catalog', () => {
    expect(resolveVoxelMaterialStyle({ kind: 'builtin', key: 'grass' }, [])).toEqual({
      color: 0x70ad62,
      roughness: 0.92,
    });
  });

  it('resolves custom project material assets', () => {
    expect(
      resolveVoxelMaterialStyle({ kind: 'asset', assetId: 'asset:voxel-material-copper' }, [
        materialAsset(),
      ]),
    ).toEqual({ color: 0xb87333, roughness: 0.9 });
  });

  it('uses a safe fallback for missing, unrelated or invalid material assets', () => {
    expect(
      resolveVoxelMaterialStyle({ kind: 'asset', assetId: 'asset:missing' }, [materialAsset()]),
    ).toEqual({ color: 0x8995a5, roughness: 0.9 });
    expect(
      resolveVoxelMaterialStyle({ kind: 'asset', assetId: 'asset:voxel-material-copper' }, [
        materialAsset({ metadata: { role: 'texture', color: 0xb87333, roughness: 0.9 } }),
      ]),
    ).toEqual({ color: 0x8995a5, roughness: 0.9 });
    expect(
      resolveVoxelMaterialStyle({ kind: 'asset', assetId: 'asset:voxel-material-copper' }, [
        materialAsset({ metadata: { role: 'voxel-material', color: 0x1000000, roughness: 4 } }),
      ]),
    ).toEqual({ color: 0x8995a5, roughness: 0.9 });
  });
});
