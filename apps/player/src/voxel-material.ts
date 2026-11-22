import type { AssetRecord } from '@engine/assets';
import type { TextureSource } from '@engine/renderer';
import type { WorldAssetPayload } from '@engine/serialization';
import { getBuiltinVoxelMaterial, type VoxelMaterialReference } from '@engine/voxel';

export interface VoxelMaterialStyle {
  readonly color: number;
  readonly roughness: number;
  readonly baseColorTexture?: TextureSource;
}

const FALLBACK_STYLE: VoxelMaterialStyle = Object.freeze({
  color: 0x8995a5,
  roughness: 0.9,
});

function decodeBase64(source: string): Uint8Array {
  const binary = atob(source);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Resolve persisted voxel material references without coupling voxel data to renderer objects. */
export function resolveVoxelMaterialStyle(
  reference: VoxelMaterialReference,
  assets: readonly AssetRecord[],
  payloads: readonly WorldAssetPayload[] = [],
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

  const textureAssetId = asset.metadata.baseColorTextureAssetId;
  if (typeof textureAssetId !== 'string') return { color, roughness };
  const textureRecord = assets.find(
    (candidate) => candidate.id === textureAssetId && candidate.kind === 'texture',
  );
  const payload = payloads.find((candidate) => candidate.assetId === textureAssetId);
  if (
    !textureRecord ||
    textureRecord.metadata.role !== 'voxel-texture' ||
    !asset.dependencies.includes(textureRecord.id) ||
    !payload ||
    payload.encoding !== 'base64' ||
    (payload.mimeType !== 'image/png' &&
      payload.mimeType !== 'image/jpeg' &&
      payload.mimeType !== 'image/webp') ||
    textureRecord.metadata.mimeType !== payload.mimeType
  ) {
    return { color, roughness };
  }
  return {
    color,
    roughness,
    baseColorTexture: {
      assetId: textureRecord.id,
      cacheKey: textureRecord.contentHash,
      mimeType: payload.mimeType,
      data: decodeBase64(payload.data),
    },
  };
}
