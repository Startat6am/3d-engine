/** Shared built-in voxel material library. Cell palettes store stable keys, never renderer objects. */
export interface BuiltinVoxelMaterial {
  readonly key: string;
  readonly label: string;
  readonly color: number;
  readonly roughness: number;
}

export const BUILTIN_VOXEL_MATERIALS: readonly BuiltinVoxelMaterial[] = Object.freeze([
  Object.freeze({ key: 'grass', label: 'Grass', color: 0x70ad62, roughness: 0.92 }),
  Object.freeze({ key: 'dirt', label: 'Dirt', color: 0x9b7048, roughness: 1 }),
  Object.freeze({ key: 'stone', label: 'Stone', color: 0x8995a5, roughness: 0.84 }),
  Object.freeze({ key: 'sand', label: 'Sand', color: 0xd8c18a, roughness: 1 }),
  Object.freeze({ key: 'wood', label: 'Wood', color: 0x95643d, roughness: 0.88 }),
  Object.freeze({ key: 'snow', label: 'Snow', color: 0xe7edf2, roughness: 0.96 }),
  Object.freeze({ key: 'water', label: 'Water', color: 0x4c91c9, roughness: 0.22 }),
]);

export function getBuiltinVoxelMaterial(key: string): BuiltinVoxelMaterial | undefined {
  return BUILTIN_VOXEL_MATERIALS.find((material) => material.key === key);
}
