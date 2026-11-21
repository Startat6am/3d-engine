import type { AssetRecord } from '@engine/assets';
import { getBuiltinVoxelMaterial, type VoxelMaterialReference } from '@engine/voxel';

export interface VoxelMaterialStyle {
  readonly color: number;
  readonly roughness: number;
}

const FALLBACK_STYLE: VoxelMaterialStyle = Object.freeze({
  color: 0x8995a5,
  roughness: 0.9,
});

/** Resolve persisted voxel material references without coupling voxel data to renderer objects. */
export function resolveVoxelMaterialStyle(
  reference: VoxelMaterialReference,
  assets: readonly AssetRecord[],
): VoxelMaterialStyle {
  if (reference.kind === 'builtin') {
    const material = getBuiltinVoxelMaterial(reference.key);
    return material ? { color: material.color, roughness: material.roughness } : FALLBACK_STYLE;
  }

  const asset = assets.find(
    (candidate) =>
      candidate.id === reference.assetId &&
      candidate.kind === 'material' &&
      candidate.metadata.role === 'voxel-material',
  );
  if (!asset) return FALLBACK_STYLE;

  const color = asset.metadata.color;
  const roughness = asset.metadata.roughness;
  if (
    typeof color !== 'number' ||
    !Number.isSafeInteger(color) ||
    color < 0 ||
    color > 0xffffff ||
    typeof roughness !== 'number' ||
    !Number.isFinite(roughness) ||
    roughness < 0 ||
    roughness > 1
  ) {
    return FALLBACK_STYLE;
  }
  return { color, roughness };
}
