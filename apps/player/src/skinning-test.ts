import { createBoxGeometry } from '@engine/geometry';
import {
  createDefaultMaterial,
  createRenderer,
  lookAtQuaternion,
  type RenderObject,
  type RenderScene,
  type SkinningDescriptor,
} from '@engine/renderer';

const canvasQuery = document.querySelector<HTMLCanvasElement>('#skinning-test');
const statusQuery = document.querySelector<HTMLOutputElement>('#status');
if (!canvasQuery || !statusQuery) throw new Error('Skinning test DOM is incomplete');
const canvasElement: HTMLCanvasElement = canvasQuery;
const status: HTMLOutputElement = statusQuery;

const renderer = createRenderer(canvasElement, { antialias: false, pixelRatioCap: 1 });
renderer.resize(320, 240);
const glQuery = canvasElement.getContext('webgl2');
if (!glQuery) throw new Error('Skinning test requires WebGL2');
const gl: WebGL2RenderingContext = glQuery;

const geometry = createBoxGeometry(1.4, 1.4, 1.4);
const vertexCount = geometry.positions.length / 3;
const jointIndices = new Uint16Array(vertexCount * 4);
const jointWeights = new Float32Array(vertexCount * 4);
for (let vertex = 0; vertex < vertexCount; vertex++) jointWeights[vertex * 4] = 1;
const palette = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const skinning: SkinningDescriptor = { jointIndices, jointWeights, palette };
const object: RenderObject = {
  id: 'skinning-contract-box',
  geometry,
  material: createDefaultMaterial(0xf2a541),
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  skinning,
};
const scene: RenderScene = {
  camera: {
    projection: 'orthographic',
    position: [0, 0, 5],
    rotation: lookAtQuaternion([0, 0, 5], [0, 0, 0]),
    near: 0.1,
    far: 100,
    orthographicHeight: 4,
  },
  objects: [object],
  background: 0x111111,
};

function snapshot(): { checksum: number; visiblePixels: number } {
  gl.finish();
  const pixels = new Uint8Array(canvasElement.width * canvasElement.height * 4);
  gl.readPixels(0, 0, canvasElement.width, canvasElement.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let checksum = 0;
  let visiblePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    checksum =
      (checksum + pixels[i]! * (i + 1) + pixels[i + 1]! * (i + 2) + pixels[i + 2]! * (i + 3)) >>> 0;
    if (pixels[i]! > 40 || pixels[i + 1]! > 40 || pixels[i + 2]! > 40) visiblePixels++;
  }
  return { checksum, visiblePixels };
}

renderer.render(scene);
const initial = snapshot();
Object.assign(window, {
  __skinningReady: true,
  __skinningInitial: initial,
  __skinningMove: () => {
    palette[12] = 0.9;
    renderer.render(scene);
    return snapshot();
  },
});
status.value = `ready:${initial.visiblePixels}`;
window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
