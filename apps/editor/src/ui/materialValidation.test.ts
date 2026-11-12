import { describe, expect, it } from 'vitest';
import { readPbrMaterialState } from './materialValidation.js';

describe('persisted PBR material validation', () => {
  it('provides backward-compatible defaults and derives legacy BLEND mode', () => {
    expect(readPbrMaterialState({}, '$.material')).toEqual({
      alphaMode: 'OPAQUE',
      alphaCutoff: 0.5,
      transparent: false,
      doubleSided: false,
      normalScale: [1, 1],
      occlusionStrength: 1,
    });
    expect(readPbrMaterialState({ transparent: true }, '$.material')).toMatchObject({
      alphaMode: 'BLEND',
      transparent: true,
    });
  });

  it('accepts valid PBR material state', () => {
    expect(
      readPbrMaterialState(
        {
          alphaMode: 'MASK',
          alphaCutoff: 0.37,
          transparent: false,
          doubleSided: true,
          normalScale: [0.45, 0.45],
          occlusionStrength: 0.62,
        },
        '$.material',
      ),
    ).toEqual({
      alphaMode: 'MASK',
      alphaCutoff: 0.37,
      transparent: false,
      doubleSided: true,
      normalScale: [0.45, 0.45],
      occlusionStrength: 0.62,
    });
  });

  it.each([
    [{ alphaMode: 'CUTOUT' }, 'alphaMode'],
    [{ alphaMode: null }, 'alphaMode'],
    [{ alphaCutoff: -0.1 }, 'alphaCutoff'],
    [{ alphaCutoff: Number.NaN }, 'alphaCutoff'],
    [{ transparent: 'false' }, 'transparent'],
    [{ alphaCutoff: null }, 'alphaCutoff'],
    [{ doubleSided: null }, 'doubleSided'],
    [{ normalScale: null }, 'normalScale'],
    [{ occlusionStrength: null }, 'occlusionStrength'],
    [{ doubleSided: 'true' }, 'doubleSided'],
    [{ normalScale: [1] }, 'normalScale'],
    [{ normalScale: [1, Number.POSITIVE_INFINITY] }, 'normalScale'],
    [{ occlusionStrength: -0.01 }, 'occlusionStrength'],
    [{ occlusionStrength: 1.01 }, 'occlusionStrength'],
  ])('rejects malformed PBR state %j', (material, field) => {
    expect(() => readPbrMaterialState(material, '$.material')).toThrow(field);
  });
});
