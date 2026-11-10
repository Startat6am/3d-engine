import { describe, expect, it } from 'vitest';
import { createDefaultCamera, createDefaultMaterial, lookAtQuaternion } from './contracts.js';

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
