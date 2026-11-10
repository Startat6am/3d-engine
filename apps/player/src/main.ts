import { EngineHost, EngineRuntime, Transform, defineComponent } from '@engine/core';
import { createBoxGeometry, type MeshData } from '@engine/geometry';
import {
  createDefaultCamera,
  createDefaultMaterial,
  ThreeWebGLRendererAdapter,
  type MaterialDescriptor,
  type RenderObject,
} from '@engine/renderer';
import * as THREE from 'three';

const canvas = document.querySelector<HTMLCanvasElement>('#player');
if (!canvas) throw new Error('Player canvas was not found');

const engine = new EngineHost({
  rendererBackends: ['webgl2'],
  supportsWebGL2: true,
  supportsWebGPU: false,
});
const renderer = new ThreeWebGLRendererAdapter(canvas);
engine.register({ stop: () => renderer.dispose() });
await engine.start();

const runtime = new EngineRuntime();
const Renderable = defineComponent<{ geometry: MeshData; material: MaterialDescriptor }>(
  'Renderable',
);
const box = runtime.world.createEntity();
runtime.world.add(box, Transform, {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  parent: null,
});
runtime.world.add(box, Renderable, {
  geometry: createBoxGeometry(),
  material: createDefaultMaterial(),
});

const camera = createDefaultCamera();
let previousFrame = 0;
let animationFrame = 0;
const renderFrame = (now: number) => {
  const delta = previousFrame === 0 ? 0 : Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  runtime.advance(delta);

  const objects: RenderObject[] = [];
  runtime.world.query(Renderable).forEach((entity, renderableValue) => {
    const renderable = renderableValue as { geometry: MeshData; material: MaterialDescriptor };
    const worldMatrix = runtime.hierarchy.getWorldMatrix(entity);
    if (!worldMatrix) return;
    const matrix = new THREE.Matrix4().fromArray(Array.from(worldMatrix));
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);
    objects.push({
      id: entity,
      geometry: renderable.geometry,
      material: renderable.material,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      scale: [scale.x, scale.y, scale.z],
    });
  });

  renderer.resize(window.innerWidth, window.innerHeight);
  renderer.render({ camera, background: 0x151a23, objects });
  animationFrame = window.requestAnimationFrame(renderFrame);
};

const onPageHide = () => {
  window.cancelAnimationFrame(animationFrame);
  void engine.dispose();
};
window.addEventListener('pagehide', onPageHide, { once: true });
animationFrame = window.requestAnimationFrame(renderFrame);
