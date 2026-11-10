import { EngineHost } from '@engine/core';
import { createBoxGeometry } from '@engine/geometry';
import {
  createDefaultCamera,
  createDefaultMaterial,
  ThreeWebGLRendererAdapter,
} from '@engine/renderer';

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
const scene = {
  camera: createDefaultCamera(),
  background: 0x151a23,
  objects: [
    {
      id: 'box',
      geometry: createBoxGeometry(),
      material: createDefaultMaterial(),
      position: [0, 0, 0] as const,
      rotation: [0, 0, 0, 1] as const,
      scale: [1, 1, 1] as const,
    },
  ],
};
const resize = () => {
  renderer.resize(window.innerWidth, window.innerHeight);
  renderer.render(scene);
};
window.addEventListener('resize', resize);
resize();
window.addEventListener(
  'pagehide',
  () => {
    window.removeEventListener('resize', resize);
    void engine.stop();
    void engine.dispose();
  },
  { once: true },
);
