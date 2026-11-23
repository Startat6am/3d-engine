import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createThreeSkinningGeometry,
  createThreeSkinningSkeleton,
  updateThreeSkinningSkeleton,
} from './skinning.js';

describe('Three.js skinning bridge', () => {
  const palette = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1,
  ]);
  const skinning = {
    jointIndices: new Uint16Array([0, 1, 0, 0]),
    jointWeights: new Float32Array([0.25, 0.75, 0, 0]),
    jointMatrices: palette,
  };

  it('adds isolated four-influence attributes without mutating cached geometry', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const geometry = createThreeSkinningGeometry(source, skinning);

    expect(geometry).not.toBe(source);
    expect(geometry.getAttribute('skinIndex').array).toEqual(skinning.jointIndices);
    expect(geometry.getAttribute('skinWeight').array).toEqual(skinning.jointWeights);
    expect(source.getAttribute('skinIndex')).toBeUndefined();

    geometry.dispose();
    source.dispose();
  });

  it('maps the engine mesh-local palette to the Three.js skeleton matrices', () => {
    const skeleton = createThreeSkinningSkeleton(skinning);
    expect(skeleton.bones).toHaveLength(2);
    expect(skeleton.boneTexture).not.toBeNull();
    const boneMatrices = skeleton.boneMatrices;
    if (!boneMatrices) throw new Error('Skeleton bone matrices were not allocated');
    expect(Array.from(boneMatrices.slice(0, palette.length))).toEqual(Array.from(palette));

    const nextPalette = palette.slice();
    nextPalette[12] = 9;
    updateThreeSkinningSkeleton(skeleton, { ...skinning, jointMatrices: nextPalette });
    const updatedBoneMatrices = skeleton.boneMatrices;
    if (!updatedBoneMatrices) throw new Error('Skeleton bone matrices were not allocated');
    expect(updatedBoneMatrices[12]).toBe(9);
    skeleton.dispose();
  });

  it('deforms a vertex through Three.js weighted skinning', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const geometry = createThreeSkinningGeometry(source, skinning);
    const skeleton = createThreeSkinningSkeleton(skinning);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(skeleton, new THREE.Matrix4());

    const deformed = mesh.applyBoneTransform(0, new THREE.Vector3());
    expect(deformed.x).toBeCloseTo(4.25);
    expect(deformed.y).toBeCloseTo(5.25);
    expect(deformed.z).toBeCloseTo(6.25);

    material.dispose();
    skeleton.dispose();
    geometry.dispose();
    source.dispose();
  });

  it('rejects a palette whose joint count changes after allocation', () => {
    const skeleton = createThreeSkinningSkeleton(skinning);
    expect(() =>
      updateThreeSkinningSkeleton(skeleton, {
        ...skinning,
        jointMatrices: new Float32Array(16),
      }),
    ).toThrow(/joint count changed/);
    skeleton.dispose();
  });
});
