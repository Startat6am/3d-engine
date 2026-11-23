import { describe, expect, it } from 'vitest';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
  validateRenderSkinning,
} from './contracts.js';

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


describe('renderer-independent skinning contracts', () => {
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 0]),
  };
  const validSkinning = () => ({
    jointIndices: new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0]),
    jointWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
    jointMatrices: new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]),
  });

  it('accepts four normalized influences and a finite mesh-local palette', () => {
    expect(() => validateRenderSkinning(geometry, validSkinning())).not.toThrow();
  });

  it('rejects mismatched influence counts, out-of-range joints and invalid weights', () => {
    const missing = validSkinning();
    missing.jointIndices = new Uint16Array(4);
    expect(() => validateRenderSkinning(geometry, missing)).toThrow(RangeError);
    const badJoint = validSkinning();
    badJoint.jointIndices[0] = 1;
    expect(() => validateRenderSkinning(geometry, badJoint)).toThrow(/exceeds palette/);
    const badWeight = validSkinning();
    badWeight.jointWeights[0] = Number.NaN;
    expect(() => validateRenderSkinning(geometry, badWeight)).toThrow(/finite and non-negative/);
    const unnormalized = validSkinning();
    unnormalized.jointWeights[0] = 0.5;
    expect(() => validateRenderSkinning(geometry, unnormalized)).toThrow(/sum to one/);
  });

  it('bounds palettes and rejects non-finite matrices', () => {
    const oversized = validSkinning();
    oversized.jointMatrices = new Float32Array(257 * 16);
    expect(() => validateRenderSkinning(geometry, oversized)).toThrow(/1\.\.256/);
    const nonFinite = validSkinning();
    nonFinite.jointMatrices[0] = Number.POSITIVE_INFINITY;
    expect(() => validateRenderSkinning(geometry, nonFinite)).toThrow(/non-finite/);
  });
});
