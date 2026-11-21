import type { AssetRecord } from '@engine/assets';
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
  type TextureSource,
} from '@engine/renderer';
import { meshVoxelChunk } from '@engine/voxel';
import { resolveVoxelMaterialStyle } from './voxel-material.js';
import { createPhysicsWorld, StaticMeshColliderSet, type PhysicsWorld } from '@engine/physics';
import { createVoxelChunkColliderInputs } from './voxel-collision.js';
import type { WorldDocument } from '@engine/serialization';
import {
  GlbImporter,
  type GlbAsset,
  type GltfPbrMaterial,
  type GltfTextureTransform,
} from '@engine/gltf-importer';
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

const canvas = document.querySelector<HTMLCanvasElement>('#player');
if (!canvas) throw new Error('Player canvas was not found');
const loadButton = document.querySelector<HTMLButtonElement>('#load-project');
const projectStatus = document.querySelector<HTMLOutputElement>('#project-status');
const projectProgress = document.createElement('section');
projectProgress.setAttribute('role', 'status');
projectProgress.setAttribute('aria-live', 'polite');
projectProgress.style.cssText =
  'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10;width:min(420px,calc(100vw - 40px));padding:20px 22px;border:1px solid #40516a;border-radius:12px;background:#111722f2;color:#e8f1ff;box-shadow:0 18px 60px #0008;font:12px ui-monospace,monospace;display:none;';
projectProgress.innerHTML =
  '<div id="project-progress-title" style="font-size:13px;font-weight:700;margin-bottom:12px">Loading project</div><div style="height:8px;border-radius:99px;background:#29384b;overflow:hidden"><div id="project-progress-fill" style="height:100%;width:0%;border-radius:99px;background:#60a5fa;transition:width 180ms ease"></div></div><div style="display:flex;justify-content:space-between;gap:12px;margin-top:10px;color:#b9c9de"><span id="project-progress-stage">Preparing…</span><span id="project-progress-value">0%</span></div>';
document.body.append(projectProgress);
const progressStage = projectProgress.querySelector<HTMLElement>('#project-progress-stage');
const progressFill = projectProgress.querySelector<HTMLElement>('#project-progress-fill');
const progressValue = projectProgress.querySelector<HTMLElement>('#project-progress-value');
const setProjectProgress = (value: number, stage: string, visible = true) => {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  projectProgress.style.display = visible ? 'block' : 'none';
  if (progressStage) progressStage.textContent = stage;
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (progressValue) progressValue.textContent = `${percent}%`;
};
const yieldToBrowser = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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
// Initialize Rapier without blocking Player startup or project-picker event wiring.
// The world and chunk-collider owner live until the page is torn down.
let physicsWorld: PhysicsWorld | null = null;
let voxelColliderSet: StaticMeshColliderSet | null = null;
let pageDisposed = false;
const physicsReady = createPhysicsWorld({ gravity: [0, -9.81, 0] }).then(
  (world) => {
    const colliders = new StaticMeshColliderSet(world);
    if (pageDisposed) {
      colliders.dispose();
      world.dispose();
      return null;
    }
    physicsWorld = world;
    voxelColliderSet = colliders;
    return { world, colliders };
  },
  (error: unknown) => {
    setProjectStatus(
      `Physics initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
    return null;
  },
);
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
const activeProjectEntities: Array<ReturnType<typeof runtime.world.createEntity>> = [];

interface PreparedRenderable {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  scale: readonly [number, number, number];
  geometry: MeshData;
  material: MaterialDescriptor;
}

interface TransformSnapshot {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

const glbImporter = new GlbImporter();

function multiplyQuaternion(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotateVector(
  value: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
): [number, number, number] {
  const [x, y, z] = value;
  const [qx, qy, qz, qw] = rotation;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
}

function composeTransform(parent: TransformSnapshot, local: TransformSnapshot): TransformSnapshot {
  const scaledLocal: [number, number, number] = [
    local.position[0] * parent.scale[0],
    local.position[1] * parent.scale[1],
    local.position[2] * parent.scale[2],
  ];
  const rotatedLocal = rotateVector(scaledLocal, parent.rotation);
  return {
    position: [
      parent.position[0] + rotatedLocal[0],
      parent.position[1] + rotatedLocal[1],
      parent.position[2] + rotatedLocal[2],
    ],
    rotation: multiplyQuaternion(parent.rotation, local.rotation),
    scale: [
      parent.scale[0] * local.scale[0],
      parent.scale[1] * local.scale[1],
      parent.scale[2] * local.scale[2],
    ],
  };
}

function readQuaternion(value: unknown): readonly [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    ? (value as [number, number, number, number])
    : [0, 0, 0, 1];
}

function colorFromFactor(factor: readonly number[]): number {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return (channel(factor[0] ?? 1) << 16) | (channel(factor[1] ?? 1) << 8) | channel(factor[2] ?? 1);
}

function textureFromGlb(
  asset: GlbAsset,
  textureIndex: number | undefined,
  assetId: string,
  contentHash: string,
  transform: GltfTextureTransform | undefined,
): TextureSource | undefined {
  if (textureIndex === undefined) return undefined;
  const texture = asset.textures[textureIndex];
  if (!texture || !texture.embedded || texture.source === null) return undefined;
  const image = asset.images[texture.source];
  if (!image) return undefined;
  const sampler = texture.sampler === null ? undefined : asset.samplers[texture.sampler];
  return {
    assetId: `${assetId}:image:${texture.source}`,
    cacheKey: `${contentHash}:image:${texture.source}`,
    mimeType: image.mimeType,
    data: image.data,
    ...(sampler ? { sampler } : {}),
    ...(transform ? { transform } : {}),
  };
}

function materialFromGlb(
  asset: GlbAsset,
  material: GltfPbrMaterial | undefined,
  assetId: string,
  contentHash: string,
): MaterialDescriptor {
  if (!material) return createDefaultMaterial(0xffffff);
  const alpha = material.baseColorFactor[3] ?? 1;
  const textures = {
    baseColorTexture: textureFromGlb(
      asset,
      material.baseColorTexture,
      assetId,
      contentHash,
      material.textureTransforms?.baseColor,
    ),
    metallicRoughnessTexture: textureFromGlb(
      asset,
      material.metallicRoughnessTexture,
      assetId,
      contentHash,
      material.textureTransforms?.metallicRoughness,
    ),
    normalTexture: textureFromGlb(
      asset,
      material.normalTexture,
      assetId,
      contentHash,
      material.textureTransforms?.normal,
    ),
    occlusionTexture: textureFromGlb(
      asset,
      material.occlusionTexture,
      assetId,
      contentHash,
      material.textureTransforms?.occlusion,
    ),
    emissiveTexture: textureFromGlb(
      asset,
      material.emissiveTexture,
      assetId,
      contentHash,
      material.textureTransforms?.emissive,
    ),
  };
  return {
    ...createDefaultMaterial(colorFromFactor(material.baseColorFactor)),
    roughness: material.roughnessFactor,
    metalness: material.metallicFactor,
    opacity: alpha,
    transparent: material.alphaMode === 'BLEND' || alpha < 1,
    emissiveColor: colorFromFactor([...material.emissiveFactor, 1]),
    alphaMode: material.alphaMode,
    alphaCutoff: material.alphaCutoff,
    doubleSided: material.doubleSided,
    normalScale: [material.normalScale, material.normalScale],
    occlusionStrength: material.occlusionStrength,
    ...(textures.baseColorTexture ? { baseColorTexture: textures.baseColorTexture } : {}),
    ...(textures.metallicRoughnessTexture
      ? { metallicRoughnessTexture: textures.metallicRoughnessTexture }
      : {}),
    ...(textures.normalTexture ? { normalTexture: textures.normalTexture } : {}),
    ...(textures.occlusionTexture ? { occlusionTexture: textures.occlusionTexture } : {}),
    ...(textures.emissiveTexture ? { emissiveTexture: textures.emissiveTexture } : {}),
  };
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function prepareWorldEntities(document: WorldDocument) {
  const prepared: PreparedRenderable[] = [];
  let unsupported = 0;
  const assetRecords = new Map<string, AssetRecord>();
  for (const value of document.assets) {
    if (isRecord(value) && typeof value.id === 'string') {
      assetRecords.set(value.id, value as unknown as AssetRecord);
    }
  }
  const payloads = new Map(
    (document.assetPayloads ?? []).map((payload) => [payload.assetId, payload]),
  );
  const importedAssets = new Map<string, Promise<GlbAsset>>();

  const loadGlbAsset = (assetId: string): Promise<GlbAsset> => {
    const cached = importedAssets.get(assetId);
    if (cached) return cached;
    const loading = (async () => {
      const record = assetRecords.get(assetId);
      const payload = payloads.get(assetId);
      if (!record || !payload || payload.encoding !== 'base64') {
        throw new Error(`GLB asset or embedded payload is missing: ${assetId}`);
      }
      if (record.importer.id !== glbImporter.id) {
        throw new Error(`Unsupported importer for GLB asset ${assetId}: ${record.importer.id}`);
      }
      const imported = await glbImporter.import(decodeBase64(payload.data), {
        uri: record.uri,
        settings: record.importer.settings,
        signal: new AbortController().signal,
      });
      return imported.data;
    })();
    importedAssets.set(assetId, loading);
    return loading;
  };

  const appendGlbEntity = async (
    rawMesh: Record<string, unknown>,
    rootTransform: TransformSnapshot,
  ): Promise<void> => {
    if (typeof rawMesh.assetId !== 'string') {
      unsupported += 1;
      return;
    }
    const assetId = rawMesh.assetId;
    try {
      const asset = await loadGlbAsset(assetId);
      const record = assetRecords.get(assetId);
      if (!record) throw new Error(`GLB asset record is missing: ${assetId}`);
      const childIndices = new Set<number>();
      for (const node of asset.nodes) for (const child of node.children) childIndices.add(child);
      const roots = asset.nodes
        .map((_, index) => index)
        .filter((index) => !childIndices.has(index));
      const visited = new Set<number>();
      const visit = (nodeIndex: number, parent: TransformSnapshot): void => {
        if (visited.has(nodeIndex)) return;
        visited.add(nodeIndex);
        const node = asset.nodes[nodeIndex];
        if (!node) return;
        const worldTransform = composeTransform(parent, {
          position: node.translation,
          rotation: node.rotation,
          scale: node.scale,
        });
        if (node.mesh !== null) {
          const mesh = asset.meshes[node.mesh];
          if (!mesh) {
            unsupported += 1;
          } else {
            for (const primitive of mesh.primitives) {
              const material =
                primitive.material === null ? undefined : asset.materials[primitive.material];
              prepared.push({
                position: worldTransform.position,
                rotation: worldTransform.rotation,
                scale: worldTransform.scale,
                geometry: primitive.mesh,
                material: materialFromGlb(asset, material, assetId, record.contentHash),
              });
            }
          }
        }
        for (const child of node.children) visit(child, worldTransform);
      };
      for (const root of roots) visit(root, rootTransform);
      if (roots.length === 0 && asset.nodes.length > 0) unsupported += 1;
    } catch {
      unsupported += 1;
    }
  };

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
    const rootTransform: TransformSnapshot = {
      position: readVector(transform.position, [0, 0, 0] as const),
      rotation: readQuaternion(transform.rotation),
      scale: readVector(transform.scale, [1, 1, 1] as const),
    };
    const primitive = mesh.primitive;
    if (primitive === 'GLB') {
      await appendGlbEntity(mesh, rootTransform);
      continue;
    }
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
        unsupported += 1;
        continue;
    }
    const rawMaterial = isRecord(mesh.material) ? mesh.material : {};
    const color =
      typeof rawMaterial.color === 'number' && Number.isFinite(rawMaterial.color)
        ? rawMaterial.color
        : 0x6ea8fe;
    prepared.push({
      position: rootTransform.position,
      rotation: rootTransform.rotation,
      scale: rootTransform.scale,
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
  // Opening the native picker is not project loading: do not show a progress bar
  // until the user has selected a directory and we can begin reading it.
  setProjectProgress(0, '', false);
  setProjectStatus('Choose a project folder…');
  try {
    const directory = await picker({ mode: 'read' });
    setProjectProgress(8, 'Reading manifest, assets and voxel chunks');
    await yieldToBrowser();
    const project = await loadVoxelWorldProject(new BrowserProjectFileStore(directory));
    setProjectProgress(52, 'Preparing scene entities and GLB models');
    await yieldToBrowser();
    const world = await prepareWorldEntities(project.document);
    setProjectProgress(68, 'Building voxel meshes');
    await yieldToBrowser();
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
        material: (() => {
          const style = resolveVoxelMaterialStyle(
            part.material,
            project.document.assets as readonly AssetRecord[],
            project.document.assetPayloads ?? [],
          );
          return {
            ...createDefaultMaterial(style.color),
            roughness: style.roughness,
            ...(style.baseColorTexture ? { baseColorTexture: style.baseColorTexture } : {}),
          };
        })(),
      }));
    });

    // Prepare and register static voxel collision before replacing the visible scene.
    // The revision token includes the source chunk and all six neighbor revisions.
    setProjectProgress(80, 'Building static voxel collision');
    await yieldToBrowser();
    const physics = await physicsReady;
    if (!physics) throw new Error('Rapier physics world is unavailable');
    const colliderInputs = createVoxelChunkColliderInputs(
      project.chunks,
      project.settings.voxelSize,
      project.settings.chunkDimensions,
    );
    physics.colliders.sync(colliderInputs);

    // Commit the replacement only after every referenced blob, render mesh and collider is ready.
    for (const entity of sampleEntities) runtime.world.destroyEntity(entity);
    for (const entity of activeProjectEntities) runtime.world.destroyEntity(entity);
    activeProjectEntities.length = 0;
    for (const entity of world.prepared) {
      activeProjectEntities.push(
        addMeshRenderable(
          entity.position,
          entity.geometry,
          entity.material,
          entity.rotation,
          entity.scale,
        ),
      );
    }
    for (const object of voxelObjects) {
      activeProjectEntities.push(
        addMeshRenderable(object.position, object.geometry, object.material),
      );
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
    setProjectProgress(88, 'Applying loaded scene');
    await yieldToBrowser();
    const chunkCount = project.chunks.length;
    // Voxel mesh parts are registered as Renderable entities alongside prepared
    // document entities; include both so the status reflects what is on screen.
    const meshCount = world.prepared.length + voxelObjects.length;
    setProjectProgress(100, 'Project loaded');
    setProjectStatus(
      `Loaded “${project.document.world.name}” · ${chunkCount} voxel chunks · ${voxelObjects.length} voxel mesh parts · ${meshCount} rendered mesh parts` +
        ` · ${colliderInputs.length} static voxel colliders` +
        (world.unsupported
          ? ` · ${world.unsupported} unsupported entities or GLB parts skipped`
          : ''),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      setProjectProgress(0, '', false);
      setProjectStatus('Project selection cancelled.');
    } else {
      setProjectProgress(0, '', false);
      setProjectStatus(
        `Could not open project: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  } finally {
    if (loadButton) loadButton.disabled = false;
    if (progressValue?.textContent === '100%') {
      window.setTimeout(() => setProjectProgress(100, 'Project loaded', false), 650);
    }
  }
}
loadButton?.addEventListener('click', () => void openProjectFolder());

let camera = createDefaultCamera();
const updateFps = attachFpsCounter(canvas);
let previousFrame = 0;
let animationFrame = 0;
let physicsAccumulator = 0;
const physicsFixedStep = 1 / 60;
const maxPhysicsFrameDelta = 0.25;
const renderFrame = (now: number) => {
  updateFps(now);
  const delta = previousFrame === 0 ? 0 : Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  runtime.advance(delta);

  // Keep Rapier on a bounded fixed timestep; large tab-resume deltas are clamped.
  physicsAccumulator += Math.min(delta, maxPhysicsFrameDelta);
  while (physicsAccumulator >= physicsFixedStep) {
    physicsWorld?.step(physicsFixedStep);
    physicsAccumulator -= physicsFixedStep;
  }

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
  pageDisposed = true;
  voxelColliderSet?.dispose();
  physicsWorld?.dispose();
  void engine.dispose();
};
window.addEventListener('pagehide', onPageHide, { once: true });
animationFrame = window.requestAnimationFrame(renderFrame);
