import * as THREE from 'three';
import type { RenderSkinning } from './contracts.js';

/** Creates an isolated geometry copy so shared cached geometry never receives per-instance skin attributes. */
export function createThreeSkinningGeometry(
  source: THREE.BufferGeometry,
  skinning: RenderSkinning,
): THREE.BufferGeometry {
  const position = source.getAttribute('position');
  if (
    !position ||
    skinning.jointIndices.length !== position.count * 4 ||
    skinning.jointWeights.length !== position.count * 4
  ) {
    throw new RangeError('Skinning attributes must contain four influences per geometry vertex');
  }
  const geometry = source.clone();
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(skinning.jointIndices, 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(skinning.jointWeights, 4),
  );
  return geometry;
}

/** Creates a Three.js skeleton whose palette is authored in mesh-local space by the engine. */
export function createThreeSkinningSkeleton(skinning: RenderSkinning): THREE.Skeleton {
  const jointCount = skinning.jointMatrices.length / 16;
  if (!Number.isSafeInteger(jointCount) || jointCount < 1 || jointCount > 256) {
    throw new RangeError('Skinning palette must contain 1..256 joints');
  }
  const bones = Array.from({ length: jointCount }, () => new THREE.Bone());
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  updateThreeSkinningSkeleton(skeleton, skinning);
  return skeleton;
}

/** Copies the engine-owned mesh-local palette into unparented bones before each draw. */
export function updateThreeSkinningSkeleton(
  skeleton: THREE.Skeleton,
  skinning: RenderSkinning,
): void {
  if (skeleton.bones.length * 16 !== skinning.jointMatrices.length) {
    throw new RangeError('Skinning palette joint count changed after skeleton creation');
  }
  for (let joint = 0; joint < skeleton.bones.length; joint += 1) {
    const bone = skeleton.bones[joint]!;
    const offset = joint * 16;
    for (let element = 0; element < 16; element += 1) {
      const value = skinning.jointMatrices[offset + element]!;
      if (!Number.isFinite(value)) {
        throw new RangeError('Skinning palette contains non-finite data');
      }
    }
    bone.matrixWorld.fromArray(skinning.jointMatrices, offset);
    bone.matrixWorldNeedsUpdate = false;
  }
  skeleton.update();
}
