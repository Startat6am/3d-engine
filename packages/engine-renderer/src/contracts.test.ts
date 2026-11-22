import { describe, expect, it } from 'vitest';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
  RendererError,
  validateSkinningDescriptor,
} from './contracts.js';
import { createBoxGeometry } from '@engine/geometry';

describe('renderer-independent camera and material contracts', () => {
  it('provides a valid perspective camera and material defaults', () => {
    const camera = createDefaultCamera();
    expect(camera.projection).toBe('perspective');
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(camera.near);
    expect(createDefaultMaterial()).toMatchObject({
      roughness: 0.7,
      metalness: 0,
      opacity: 1,
      transparent: false,
    });
  });
  it('creates normalized look-at rotations', () => {
    const q = lookAtQuaternion([0, 0, 5], [0, 0, 0]);
    expect(Math.hypot(...q)).toBeCloseTo(1);
    expect(() => lookAtQuaternion([0, 0, 0], [0, 0, 0])).toThrow(RangeError);
  });
});

describe('renderer skinning contracts', () => {
  it('accepts four influences per vertex and a column-major palette', () => {
    const geometry = createBoxGeometry();
    const vertexCount = geometry.positions.length / 3;
    const skinning = {
      jointIndices: new Uint16Array(vertexCount * 4),
      jointWeights: new Float32Array(
        Array.from({ length: vertexCount }, () => [2, 0, 0, 0]).flat(),
      ),
      palette: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    };
    expect(() => validateSkinningDescriptor(geometry, skinning)).not.toThrow();
  });

  it('rejects invalid influence counts, joint references and zero-weight vertices', () => {
    const geometry = createBoxGeometry();
    const vertexCount = geometry.positions.length / 3;
    const valid = {
      jointIndices: new Uint16Array(vertexCount * 4),
      jointWeights: new Float32Array(
        Array.from({ length: vertexCount }, () => [1, 0, 0, 0]).flat(),
      ),
      palette: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    };
    expect(() =>
      validateSkinningDescriptor(geometry, { ...valid, jointWeights: new Float32Array(4) }),
    ).toThrowError(RendererError);
    const invalidJoint = valid.jointIndices.slice();
    invalidJoint[0] = 1;
    expect(() =>
      validateSkinningDescriptor(geometry, { ...valid, jointIndices: invalidJoint }),
    ).toThrowError(RendererError);
    const zeroWeights = valid.jointWeights.slice();
    zeroWeights.fill(0, 0, 4);
    expect(() =>
      validateSkinningDescriptor(geometry, { ...valid, jointWeights: zeroWeights }),
    ).toThrowError(RendererError);
  });
});
