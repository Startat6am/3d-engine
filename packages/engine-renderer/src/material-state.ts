import * as THREE from 'three';
import type { MaterialDescriptor } from './contracts.js';

/** Applies backend-neutral material state to the renderer's Three.js material. */
export function applyMaterialState(
  material: THREE.MeshStandardMaterial,
  descriptor: MaterialDescriptor,
): void {
  material.color.setHex(descriptor.color);
  material.roughness = descriptor.roughness;
  material.metalness = descriptor.metalness;
  material.opacity = descriptor.opacity;
  const alphaMode = descriptor.alphaMode ?? (descriptor.transparent ? 'BLEND' : 'OPAQUE');
  material.transparent = alphaMode === 'BLEND';
  material.alphaTest = alphaMode === 'MASK' ? (descriptor.alphaCutoff ?? 0.5) : 0;
  material.side = descriptor.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  material.normalScale.set(...(descriptor.normalScale ?? [1, 1]));
  material.aoMapIntensity = descriptor.occlusionStrength ?? 1;
  material.wireframe = descriptor.wireframe;
  material.emissive.setHex(descriptor.emissiveColor ?? 0x000000);
}
