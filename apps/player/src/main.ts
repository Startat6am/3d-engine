import { EngineHost, EngineRuntime, Transform, defineComponent } from '@engine/core';
import {
  createBoxGeometry,
  createCylinderGeometry,
  createPlaneGeometry,
  createUvSphereGeometry,
  type MeshData,
} from '@engine/geometry';
import {
  BrowserProjectFileStore,
  loadVoxelWorldProject,
  type DirectoryHandleLike,
} from '@engine/project-storage';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
  ThreeWebGLRendererAdapter,
  type MaterialDescriptor,
  type RenderObject,
} from '@engine/renderer';
import { meshVoxelChunk, type VoxelMaterialReference } from '@engine/voxel';
import type { WorldDocument } from '@engine/serialization';
import { attachFpsCounter } from './fps-counter.js';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { readonly mode?: 'read' }) => Promise<DirectoryHandleLike>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVector(
  value: unknown,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? (value as [number, number, number])
    : fallback;
}

function chunkKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function materialColor(reference: VoxelMaterialReference): number {
  if (reference.kind === 'asset') return 0x9ca3af;
  const colors: Readonly<Record<string, number>> = {
    grass: 0x65a30d,
    dirt: 0x92400e,
    stone: 0x94a3b8,
    sand: 0xe7c77a,
    wood: 0x9a6338,
    water: 0x3b82f6,
    snow: 0xe2e8f0,
  };
  return colors[reference.key.toLowerCase()] ?? 0x9ca3af;
}

const canvas = document.querySelector<HTMLCanvasElement>('#player');
if (!canvas) throw new Error('Player canvas was not found');
const loadButton = document.querySelector<HTMLButtonElement>('#load-project');
const projectStatus = document.querySelector<HTMLOutputElement>('#project-status');

const setProjectStatus = (message: string, isError = false) => {
  if (!projectStatus) return;
  projectStatus.value = message;
  projectStatus.style.color = isError ? '#fca5a5' : '#d9e7fa';
};

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
const addMeshRenderable = (
  position: readonly [number, number, number],
  geometry: MeshData,
  material: MaterialDescriptor,
  rotation: readonly [number, number, number, number] = [0, 0, 0, 1],
  scale: readonly [number, number, number] = [1, 1, 1],
) => {
  const entity = runtime.world.createEntity();
  runtime.world.add(entity, Transform, { position, rotation, scale, parent: null });
  runtime.world.add(entity, Renderable, { geometry, material });
  return entity;
};
const addRenderable = (
  position: readonly [number, number, number],
  geometry: MeshData,
  color: number,
  scale: readonly [number, number, number] = [1, 1, 1],
) => addMeshRenderable(position, geometry, createDefaultMaterial(color), [0, 0, 0, 1], scale);

// Keep the original primitive acceptance scene until a project has been fully validated.
const sampleEntities = [
  addRenderable([0, -0.55, 0], createPlaneGeometry(4, 3, 4, 3), 0x334155),
  addRenderable([-1.25, 0, 0], createBoxGeometry(), 0x6ea8fe, [0.8, 0.8, 0.8]),
  addRenderable([0, 0, 0], createUvSphereGeometry(0.5, 24, 16), 0xf59e0b, [0.9, 0.9, 0.9]),
  addRenderable([1.25, 0, 0], createCylinderGeometry(), 0x34d399, [0.8, 0.9, 0.8]),
];

function prepareWorldEntities(document: WorldDocument) {
  const prepared: Array<{
    position: readonly [number, number, number];
    rotation: readonly [number, number, number, number];
    scale: readonly [number, number, number];
    geometry: MeshData;
    material: MaterialDescriptor;
  }> = [];
  let unsupported = 0;
  for (const rawEntity of document.world.entities) {
    if (!isRecord(rawEntity) || !isRecord(rawEntity.components)) {
      unsupported += 1;
      continue;
    }
    const transform = rawEntity.components.Transform;
    const mesh = rawEntity.components.MeshRenderer;
    if (!isRecord(transform) || !isRecord(mesh)) {
      unsupported += 1;
      continue;
    }
    const position = readVector(transform.position, [0, 0, 0] as const);
    const rotation =
      Array.isArray(transform.rotation) &&
      transform.rotation.length === 4 &&
      transform.rotation.every(Number.isFinite)
        ? (transform.rotation as [number, number, number, number])
        : ([0, 0, 0, 1] as const);
    const scale = readVector(transform.scale, [1, 1, 1] as const);
    const primitive = mesh.primitive;
    let geometry: MeshData;
    switch (primitive) {
      case 'Box':
        geometry = createBoxGeometry();
        break;
      case 'Sphere':
        geometry = createUvSphereGeometry();
        break;
      case 'Plane':
        geometry = createPlaneGeometry(4, 4, 1, 1);
        break;
      case 'Cylinder':
        geometry = createCylinderGeometry();
        break;
      default:
        // GLB assets need the Player asset-decoding pipeline; do not silently substitute geometry.
        unsupported += 1;
        continue;
    }
    const rawMaterial = isRecord(mesh.material) ? mesh.material : {};
    const color =
      typeof rawMaterial.color === 'number' && Number.isFinite(rawMaterial.color)
        ? rawMaterial.color
        : 0x6ea8fe;
    prepared.push({
      position: position as [number, number, number],
      rotation,
      scale: scale as [number, number, number],
      geometry,
      material: {
        ...createDefaultMaterial(color),
        ...(typeof rawMaterial.roughness === 'number' ? { roughness: rawMaterial.roughness } : {}),
        ...(typeof rawMaterial.metalness === 'number' ? { metalness: rawMaterial.metalness } : {}),
        ...(typeof rawMaterial.opacity === 'number' ? { opacity: rawMaterial.opacity } : {}),
        ...(typeof rawMaterial.transparent === 'boolean'
          ? { transparent: rawMaterial.transparent }
          : {}),
        ...(typeof rawMaterial.wireframe === 'boolean' ? { wireframe: rawMaterial.wireframe } : {}),
      },
    });
  }
  return { prepared, unsupported };
}

async function openProjectFolder(): Promise<void> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    setProjectStatus(
      'Folder access is not supported in this browser. Use a Chromium-based browser over HTTPS.',
      true,
    );
    return;
  }
  if (loadButton) loadButton.disabled = true;
  setProjectStatus('Opening project… verifying manifest, assets and voxel chunk hashes.');
  try {
    const directory = await picker({ mode: 'read' });
    const project = await loadVoxelWorldProject(new BrowserProjectFileStore(directory));
    const world = prepareWorldEntities(project.document);
    const chunksByCoordinate = new Map(
      project.chunks.map((chunk) => [
        chunkKey(chunk.coordinate.x, chunk.coordinate.y, chunk.coordinate.z),
        chunk,
      ]),
    );
    const voxelObjects = project.chunks.flatMap((chunk) => {
      const { x, y, z } = chunk.coordinate;
      const neighbor = (dx: number, dy: number, dz: number) =>
        chunksByCoordinate.get(chunkKey(x + dx, y + dy, z + dz));
      const positiveX = neighbor(1, 0, 0);
      const negativeX = neighbor(-1, 0, 0);
      const positiveY = neighbor(0, 1, 0);
      const negativeY = neighbor(0, -1, 0);
      const positiveZ = neighbor(0, 0, 1);
      const negativeZ = neighbor(0, 0, -1);
      const neighbors = {
        ...(positiveX ? { positiveX } : {}),
        ...(negativeX ? { negativeX } : {}),
        ...(positiveY ? { positiveY } : {}),
        ...(negativeY ? { negativeY } : {}),
        ...(positiveZ ? { positiveZ } : {}),
        ...(negativeZ ? { negativeZ } : {}),
      };
      const mesh = meshVoxelChunk(chunk, neighbors, project.settings.voxelSize);
      const origin: [number, number, number] = [
        chunk.coordinate.x * project.settings.chunkDimensions.x * project.settings.voxelSize,
        chunk.coordinate.y * project.settings.chunkDimensions.y * project.settings.voxelSize,
        chunk.coordinate.z * project.settings.chunkDimensions.z * project.settings.voxelSize,
      ];
      return mesh.parts.map((part) => ({
        position: origin,
        geometry: part.geometry,
        material: createDefaultMaterial(materialColor(part.material)),
      }));
    });

    // Commit the replacement only after every referenced blob and mesh has been prepared.
    for (const entity of sampleEntities) runtime.world.destroyEntity(entity);
    for (const entity of world.prepared) {
      addMeshRenderable(
        entity.position,
        entity.geometry,
        entity.material,
        entity.rotation,
        entity.scale,
      );
    }
    for (const object of voxelObjects) {
      addMeshRenderable(object.position, object.geometry, object.material);
    }
    const chunkBounds = project.chunks.flatMap((chunk) => {
      const origin = [
        chunk.coordinate.x * project.settings.chunkDimensions.x * project.settings.voxelSize,
        chunk.coordinate.y * project.settings.chunkDimensions.y * project.settings.voxelSize,
        chunk.coordinate.z * project.settings.chunkDimensions.z * project.settings.voxelSize,
      ];
      return [
        origin as [number, number, number],
        [
          origin[0]! + project.settings.chunkDimensions.x * project.settings.voxelSize,
          origin[1]! + project.settings.chunkDimensions.y * project.settings.voxelSize,
          origin[2]! + project.settings.chunkDimensions.z * project.settings.voxelSize,
        ] as [number, number, number],
      ];
    });
    const bounds = [...world.prepared.map((entity) => entity.position), ...chunkBounds];
    if (bounds.length > 0) {
      const min = [0, 1, 2].map((axis) => Math.min(...bounds.map((point) => point[axis]!)));
      const max = [0, 1, 2].map((axis) => Math.max(...bounds.map((point) => point[axis]!)));
      const target: [number, number, number] = [
        (min[0]! + max[0]!) / 2,
        (min[1]! + max[1]!) / 2,
        (min[2]! + max[2]!) / 2,
      ];
      const extent = Math.max(4, max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
      const distance = extent * 1.8;
      const cameraPosition: [number, number, number] = [
        target[0] + distance,
        target[1] + distance * 0.7,
        target[2] + distance,
      ];
      camera = {
        ...camera,
        position: cameraPosition,
        rotation: lookAtQuaternion(cameraPosition, target),
      };
    }
    const chunkCount = project.chunks.length;
    const meshCount = world.prepared.length;
    setProjectStatus(
      `Loaded “${project.document.world.name}” · ${chunkCount} voxel chunks · ${voxelObjects.length} voxel mesh parts · ${meshCount} primitive entities` +
        (world.unsupported
          ? ` · ${world.unsupported} unsupported entities skipped (GLB/custom components)`
          : ''),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      setProjectStatus('Project selection cancelled.');
    } else {
      setProjectStatus(
        `Could not open project: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  } finally {
    if (loadButton) loadButton.disabled = false;
  }
}
loadButton?.addEventListener('click', () => void openProjectFolder());

let camera = createDefaultCamera();
const updateFps = attachFpsCounter(canvas);
let previousFrame = 0;
let animationFrame = 0;
const renderFrame = (now: number) => {
  updateFps(now);
  const delta = previousFrame === 0 ? 0 : Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  runtime.advance(delta);

  const objects: RenderObject[] = [];
  runtime.world.query(Renderable).forEach((entity, renderableValue) => {
    const renderable = renderableValue as { geometry: MeshData; material: MaterialDescriptor };
    const worldMatrix = runtime.hierarchy.getWorldMatrix(entity);
    if (!worldMatrix) return;
    objects.push({
      id: entity,
      geometry: renderable.geometry,
      material: renderable.material,
      worldMatrix,
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
