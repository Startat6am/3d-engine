export interface PbrMaterialState {
  readonly alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  readonly alphaCutoff: number;
  readonly transparent: boolean;
  readonly doubleSided: boolean;
  readonly normalScale: readonly [number, number];
  readonly occlusionStrength: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates persisted glTF PBR fields before a world is committed to the editor. */
export function readPbrMaterialState(value: unknown, path: string): PbrMaterialState {
  if (!isRecord(value)) throw new Error(`Material must be an object at ${path}`);

  const transparent = value.transparent === undefined ? false : value.transparent;
  if (typeof transparent !== 'boolean') {
    throw new Error(`Material transparent must be a boolean at ${path}.transparent`);
  }

  const alphaMode =
    value.alphaMode === undefined ? (transparent ? 'BLEND' : 'OPAQUE') : value.alphaMode;
  if (alphaMode !== 'OPAQUE' && alphaMode !== 'MASK' && alphaMode !== 'BLEND') {
    throw new Error(`Material alphaMode is invalid at ${path}.alphaMode`);
  }

  const alphaCutoff = value.alphaCutoff === undefined ? 0.5 : value.alphaCutoff;
  if (typeof alphaCutoff !== 'number' || !Number.isFinite(alphaCutoff) || alphaCutoff < 0) {
    throw new Error(
      `Material alphaCutoff must be a finite non-negative number at ${path}.alphaCutoff`,
    );
  }

  const doubleSided = value.doubleSided === undefined ? false : value.doubleSided;
  if (typeof doubleSided !== 'boolean') {
    throw new Error(`Material doubleSided must be a boolean at ${path}.doubleSided`);
  }

  const normalScale = value.normalScale === undefined ? [1, 1] : value.normalScale;
  if (
    !Array.isArray(normalScale) ||
    normalScale.length !== 2 ||
    !normalScale.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    throw new Error(`Material normalScale must contain two finite numbers at ${path}.normalScale`);
  }

  const occlusionStrength = value.occlusionStrength === undefined ? 1 : value.occlusionStrength;
  if (
    typeof occlusionStrength !== 'number' ||
    !Number.isFinite(occlusionStrength) ||
    occlusionStrength < 0 ||
    occlusionStrength > 1
  ) {
    throw new Error(
      `Material occlusionStrength must be between 0 and 1 at ${path}.occlusionStrength`,
    );
  }

  return {
    alphaMode,
    alphaCutoff,
    transparent: alphaMode === 'BLEND',
    doubleSided,
    normalScale: [normalScale[0] as number, normalScale[1] as number],
    occlusionStrength,
  };
}
