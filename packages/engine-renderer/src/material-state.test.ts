import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultMaterial } from './contracts.js';
import { applyMaterialState } from './material-state.js';

describe('renderer PBR material state', () => {
  it('applies mask cutoff, double-sided rendering, normal scale, and occlusion strength', () => {
    const material = new THREE.MeshStandardMaterial();
    applyMaterialState(material, {
      ...createDefaultMaterial(),
      alphaMode: 'MASK',
      alphaCutoff: 0.37,
      doubleSided: true,
      normalScale: [0.45, 0.45],
      occlusionStrength: 0.62,
    });

    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0.37);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.normalScale.toArray()).toEqual([0.45, 0.45]);
    expect(material.aoMapIntensity).toBe(0.62);
    material.dispose();
  });

  it('keeps OPAQUE materials opaque even when legacy transparency is set', () => {
    const material = new THREE.MeshStandardMaterial();
    applyMaterialState(material, {
      ...createDefaultMaterial(),
      transparent: true,
      alphaMode: 'OPAQUE',
    });

    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0);
    material.dispose();
  });

  it('enables blending only for BLEND materials', () => {
    const material = new THREE.MeshStandardMaterial();
    applyMaterialState(material, {
      ...createDefaultMaterial(),
      transparent: false,
      alphaMode: 'BLEND',
    });

    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBe(0);
    material.dispose();
  });
});
