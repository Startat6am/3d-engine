import { EngineHost } from '@engine/core';
import { createBoxGeometry } from '@engine/geometry';
import { ThreeWebGLRendererAdapter } from '@engine/renderer';

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
renderer.setMeshes([{ geometry: createBoxGeometry(), color: 0x6ea8fe }]);
const resize = () => {
  renderer.resize(window.innerWidth, window.innerHeight);
  renderer.render();
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
