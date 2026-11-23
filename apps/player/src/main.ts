import {
  AnimationPlayer,
  createAnimationPose,
  evaluateSkinningMatrices,
  type AnimationSkin,
} from '@engine/animation';
import {
  AudioRuntime,
  createAudioSourceState,
  WebAudioBackend,
  type AudioClipHandle,
  type AudioSourceState,
  type AudioVoice,
} from '@engine/audio';
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
  openVoxelWorldProject,
  type DirectoryHandleLike,
} from '@engine/project-storage';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
  ThreeWebGLRendererAdapter,
  type MaterialDescriptor,
  type RenderObject,
  type RenderSkinning,
  type TextureSource,
} from '@engine/renderer';
import { createVoxelChunkSnapshot, meshVoxelChunkAsync } from '@engine/voxel';
import { WorldChunkScheduler, type ChunkCoordinate3 } from '@engine/world';
import { selectVoxelStreamingWindow } from './voxel-streaming.js';
import {
  fulfilledVoxelNeighbors,
  pruneVoxelSourceCache,
  readVoxelSourceCache,
  writeVoxelSourceCache,
} from './voxel-source-cache.js';
import { resolveVoxelMaterialStyle } from './voxel-material.js';
import { createPhysicsWorld, StaticMeshColliderSet, type PhysicsWorld } from '@engine/physics';
import { createVoxelChunkColliderInputs } from './voxel-collision.js';
import {
  CURRENT_WORLD_SCHEMA_VERSION,
  parseWorld,
  serializeWorld,
  type WorldDocument,
} from '@engine/serialization';
import {
  GlbImporter,
  type GlbAsset,
  type GltfPbrMaterial,
  type GltfTextureTransform,
} from '@engine/gltf-importer';
import { attachFpsCounter } from './fps-counter.js';
import foxFixtureUrl from '../../../packages/engine-gltf-importer/src/fixtures/Fox.glb?url';

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
const audioTestButton = document.querySelector<HTMLButtonElement>('#audio-test');
const audioBackend = new WebAudioBackend();
const audioRuntime = new AudioRuntime(audioBackend);
let audioTestClip: AudioClipHandle | null = null;
let audioTestVoice: AudioVoice | null = null;
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

function createSpatialTestTone(): ArrayBuffer {
  const sampleRate = 22_050;
  const sampleCount = sampleRate;
  const bytes = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  for (let sample = 0; sample < sampleCount; sample++) {
    const envelope = Math.min(1, sample / 300, (sampleCount - sample) / 300);
    const value = Math.sin((2 * Math.PI * 440 * sample) / sampleRate) * 0.22 * envelope;
    view.setInt16(44 + sample * 2, Math.round(value * 32767), true);
  }
  return bytes;
}

if (audioTestButton) {
  audioTestButton.addEventListener('click', async () => {
    audioTestButton.disabled = true;
    try {
      await audioRuntime.activateFromUserGesture();
      if (activeAudioSources.length > 0) {
        await activateProjectAudioSources();
        audioTestButton.textContent = 'Project audio enabled';
        setProjectStatus(`Enabled ${activeAudioSources.length} project audio source(s)`);
      } else {
        if (!audioTestClip) {
          audioTestClip = await audioRuntime.loadClip({
            id: 'builtin:spatial-audio-test-tone',
            mimeType: 'audio/wav',
            bytes: createSpatialTestTone(),
          });
        }
        audioTestVoice?.dispose();
        const sourcePosition: [number, number, number] = [
          camera.position[0],
          camera.position[1],
          camera.position[2] - 5,
        ];
        audioTestVoice = audioRuntime.createVoice(
          audioTestClip.id,
          createAudioSourceState(sourcePosition, {
            gain: 0.5,
            loop: true,
            spatialBlend: 1,
            referenceDistance: 1,
            maxDistance: 30,
            rolloff: 1,
          }),
        );
        audioTestVoice.play();
        audioTestButton.textContent = 'Spatial audio playing';
      }
      if (import.meta.env.DEV) {
        const debugWindow = window as Window & {
          __playerAudioActive?: boolean;
          __playerAudioVoices?: number;
          __playerAudioSpatialization?: string;
          __playerAudioContextState?: string;
        };
        debugWindow.__playerAudioActive = audioRuntime.active;
        debugWindow.__playerAudioVoices = audioRuntime.voiceCount;
        debugWindow.__playerAudioSpatialization = audioRuntime.capabilities.spatialization;
        debugWindow.__playerAudioContextState = audioBackend.contextState;
      }
    } catch (error) {
      audioTestButton.textContent = 'Audio test failed';
      setProjectStatus(error instanceof Error ? error.message : 'Audio test failed', true);
    } finally {
      audioTestButton.disabled = false;
    }
  });
}

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
const Renderable = defineComponent<{
  geometry: MeshData;
  material: MaterialDescriptor;
  skinning?: RenderSkinning;
}>('Renderable');
const addMeshRenderable = (
  position: readonly [number, number, number],
  geometry: MeshData,
  material: MaterialDescriptor,
  rotation: readonly [number, number, number, number] = [0, 0, 0, 1],
  scale: readonly [number, number, number] = [1, 1, 1],
  skinning?: RenderSkinning,
) => {
  const entity = runtime.world.createEntity();
  runtime.world.add(entity, Transform, { position, rotation, scale, parent: null });
  runtime.world.add(entity, Renderable, {
    geometry,
    material,
    ...(skinning ? { skinning } : {}),
  });
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

interface ActiveAnimationBinding {
  readonly skin: AnimationSkin;
  readonly meshNodeIndex: number;
  readonly palettes: readonly Float32Array[];
}

interface ActiveAnimationInstance {
  readonly player: AnimationPlayer;
  readonly parents: readonly (number | null)[];
  readonly bindings: readonly ActiveAnimationBinding[];
  readonly clipNames: readonly string[];
  clipIndex: number;
}

interface PreparedAudioSource {
  readonly assetId: string;
  readonly mimeType: string;
  readonly bytes: ArrayBuffer;
  readonly playOnEnable: boolean;
  state: AudioSourceState;
}

interface ActiveAudioSource extends PreparedAudioSource {
  readonly entity: ReturnType<typeof runtime.world.createEntity>;
  voice: AudioVoice | null;
}

const activeAnimations: ActiveAnimationInstance[] = [];
const activeAudioSources: ActiveAudioSource[] = [];

function addAudioSourceRuntimeEntity(source: PreparedAudioSource): ActiveAudioSource {
  const entity = runtime.world.createEntity();
  runtime.world.add(entity, Transform, {
    position: source.state.position,
    rotation: source.state.orientation,
    scale: [1, 1, 1],
    parent: null,
  });
  activeProjectEntities.push(entity);
  return { ...source, entity, voice: null };
}

async function activateProjectAudioSources(): Promise<void> {
  for (const source of activeAudioSources) {
    const clip = await audioRuntime.loadClip({
      id: source.assetId,
      mimeType: source.mimeType,
      bytes: source.bytes,
    });
    source.voice?.dispose();
    source.voice = audioRuntime.createVoice(clip.id, source.state);
    if (source.playOnEnable) source.voice.play();
  }
}

interface PreparedRenderable {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  scale: readonly [number, number, number];
  geometry: MeshData;
  material: MaterialDescriptor;
  skinning?: RenderSkinning;
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

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1)
    binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}

async function prepareWorldEntities(document: WorldDocument) {
  const prepared: PreparedRenderable[] = [];
  const animations: ActiveAnimationInstance[] = [];
  const audioSources: PreparedAudioSource[] = [];
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
      const bindPose = createAnimationPose(asset.nodes.length);
      const parents: Array<number | null> = Array.from({ length: asset.nodes.length }, () => null);
      for (const [nodeIndex, node] of asset.nodes.entries()) {
        bindPose[nodeIndex]!.translation.set(node.translation);
        bindPose[nodeIndex]!.rotation.set(node.rotation);
        bindPose[nodeIndex]!.scale.set(node.scale);
        for (const child of node.children) parents[child] = nodeIndex;
      }
      const player =
        asset.animations.length > 0 ? new AnimationPlayer(asset.animations, bindPose) : null;
      if (player) player.play(asset.animations[0]!.name);
      const animationBindings: ActiveAnimationBinding[] = [];
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
          const skin = node.skin === null ? undefined : asset.skins[node.skin];
          const palettes: Float32Array[] = [];
          if (!mesh) {
            unsupported += 1;
          } else {
            for (const primitive of mesh.primitives) {
              const material =
                primitive.material === null ? undefined : asset.materials[primitive.material];
              const skinning =
                skin && primitive.skinning
                  ? {
                      jointIndices: primitive.skinning.joints,
                      jointWeights: primitive.skinning.weights,
                      jointMatrices: evaluateSkinningMatrices(
                        player?.pose ?? bindPose,
                        parents,
                        skin,
                        nodeIndex,
                      ),
                    }
                  : undefined;
              if (skinning) palettes.push(skinning.jointMatrices);
              prepared.push({
                position: worldTransform.position,
                rotation: worldTransform.rotation,
                scale: worldTransform.scale,
                geometry: primitive.mesh,
                material: materialFromGlb(asset, material, assetId, record.contentHash),
                ...(skinning ? { skinning } : {}),
              });
            }
          }
          if (player && skin && palettes.length > 0) {
            animationBindings.push({ skin, meshNodeIndex: nodeIndex, palettes });
          }
        }
        for (const child of node.children) visit(child, worldTransform);
      };
      for (const root of roots) visit(root, rootTransform);
      if (player && animationBindings.length > 0) {
        animations.push({
          player,
          parents,
          bindings: animationBindings,
          clipNames: asset.animations.map((clip) => clip.name),
          clipIndex: 0,
        });
      }
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
    const audioSource = rawEntity.components.AudioSource;
    if (!isRecord(transform)) {
      unsupported += 1;
      continue;
    }
    const rootTransform: TransformSnapshot = {
      position: readVector(transform.position, [0, 0, 0] as const),
      rotation: readQuaternion(transform.rotation),
      scale: readVector(transform.scale, [1, 1, 1] as const),
    };
    if (isRecord(audioSource)) {
      const assetId = audioSource.assetId;
      const record = typeof assetId === 'string' ? assetRecords.get(assetId) : undefined;
      const payload = typeof assetId === 'string' ? payloads.get(assetId) : undefined;
      if (
        typeof assetId !== 'string' ||
        !record ||
        record.kind !== 'audio' ||
        !payload ||
        payload.encoding !== 'base64' ||
        typeof payload.mimeType !== 'string'
      ) {
        unsupported += 1;
      } else {
        audioSources.push({
          assetId,
          mimeType: payload.mimeType,
          bytes: decodeBase64(payload.data),
          playOnEnable: audioSource.playOnEnable === true,
          state: createAudioSourceState(rootTransform.position, {
            gain: audioSource.gain as number,
            loop: audioSource.loop as boolean,
            spatialBlend: audioSource.spatial ? 1 : 0,
            referenceDistance: audioSource.referenceDistance as number,
            maxDistance: audioSource.maxDistance as number,
            rolloff: 1,
          }),
        });
      }
    }
    if (!isRecord(mesh)) {
      if (!isRecord(audioSource)) unsupported += 1;
      continue;
    }
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
  return { prepared, unsupported, animations, audioSources };
}

type PlayerVoxelChunk = Awaited<ReturnType<typeof openVoxelWorldProject>>['chunks'][number];
type PlayerVoxelChunkSnapshot = Awaited<
  ReturnType<Awaited<ReturnType<typeof openVoxelWorldProject>>['loadChunk']>
>;

interface VoxelStreamProject {
  readonly settings: {
    readonly voxelSize: number;
    readonly chunkDimensions: { readonly x: number; readonly y: number; readonly z: number };
  };
  readonly document: WorldDocument;
}

interface VoxelStreamResident {
  readonly release: () => void;
  readonly byteLength: number;
}

let projectDirectorySelected = false;
let voxelStream: {
  update(position: readonly [number, number, number]): void;
  dispose(): void;
} | null = null;

function createSampleVoxelScene(): {
  readonly candidates: readonly PlayerVoxelChunk[];
  readonly loadChunk: (coordinate: ChunkCoordinate3) => Promise<PlayerVoxelChunkSnapshot>;
  readonly project: VoxelStreamProject;
} {
  const palette = [
    { material: { kind: 'builtin' as const, key: 'grass' } },
    { material: { kind: 'builtin' as const, key: 'dirt' } },
    { material: { kind: 'builtin' as const, key: 'stone' } },
  ];
  const snapshots = new Map<string, PlayerVoxelChunkSnapshot>();
  const candidates: PlayerVoxelChunk[] = [];

  // A 9×7 field of 16³ chunks gives the Player enough room to demonstrate
  // camera-window streaming, eviction, and re-entry without opening a folder.
  for (let chunkZ = -3; chunkZ <= 3; chunkZ += 1) {
    for (let chunkX = -4; chunkX <= 4; chunkX += 1) {
      const coordinate = { x: chunkX, y: 0, z: chunkZ };
      const cells = new Uint16Array(16 * 16 * 16);
      for (let z = 0; z < 16; z += 1) {
        for (let x = 0; x < 16; x += 1) {
          // Keep the sample terrain deliberately light: one grass layer per
          // chunk still exercises meshing/collision/streaming without a huge demo load.
          cells[x + 16 * z] = 1;
        }
      }
      // A small stone lookout tower in the center chunk makes the demo easy to orient in.
      if (chunkX === 0 && chunkZ === 0) {
        for (let y = 2; y < 9; y += 1) {
          for (let z = 6; z <= 9; z += 1) {
            for (let x = 6; x <= 9; x += 1) {
              if (x === 6 || x === 9 || z === 6 || z === 9 || y === 8) {
                cells[x + 16 * (y + 16 * z)] = 3;
              }
            }
          }
        }
      }
      const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells });
      const key = chunkKey(chunkX, 0, chunkZ);
      snapshots.set(key, snapshot);
      candidates.push({
        coordinate,
        revision: snapshot.revision,
        palette,
        payload: {
          assetId: `sample-voxel-chunk:${key}`,
          byteLength: cells.byteLength,
          codecVersion: 1,
          contentHash: `sample:${key}`,
        },
      });
    }
  }

  const document: WorldDocument = {
    format: 'universal-3d-world',
    schemaVersion: '1.0.0',
    engineVersion: '0.1.0',
    world: {
      id: 'player-sample-voxel-world',
      name: 'Voxel Streaming Test Scene',
      settings: {},
      entities: [],
    },
    assets: [],
    extensions: {},
  };
  return {
    candidates,
    loadChunk: async (coordinate) => {
      const snapshot = snapshots.get(chunkKey(coordinate.x, coordinate.y, coordinate.z));
      if (!snapshot)
        throw new Error(
          `Sample voxel chunk not found: ${chunkKey(coordinate.x, coordinate.y, coordinate.z)}`,
        );
      // Yield between chunk reads just like the asynchronous project-backed loader.
      if (import.meta.env.DEV) {
        const debugWindow = window as Window & { __playerSampleChunkLoads?: number };
        debugWindow.__playerSampleChunkLoads = (debugWindow.__playerSampleChunkLoads ?? 0) + 1;
      }
      await Promise.resolve();
      return snapshot;
    },
    project: {
      settings: { voxelSize: 1, chunkDimensions: { x: 16, y: 16, z: 16 } },
      document,
    },
  };
}

function createVoxelStream(
  candidates: readonly PlayerVoxelChunk[],
  loadChunk: (coordinate: ChunkCoordinate3) => Promise<PlayerVoxelChunkSnapshot>,
  project: VoxelStreamProject,
  physics: NonNullable<Awaited<typeof physicsReady>>,
  options: { readonly enableColliders?: boolean } = {},
) {
  const enableColliders = options.enableColliders ?? true;
  const candidateByKey = new Map(
    candidates.map((candidate) => [
      chunkKey(candidate.coordinate.x, candidate.coordinate.y, candidate.coordinate.z),
      candidate,
    ]),
  );
  const renderEntities = new Map<string, ReturnType<typeof runtime.world.createEntity>[]>();
  const sourceCache = new Map<string, PlayerVoxelChunkSnapshot>();
  const sourcePending = new Map<string, Promise<PlayerVoxelChunkSnapshot>>();
  const activeColliderKeys = new Set<string>();
  let sourceKeepKeys = new Set<string>();
  const scheduler = new WorldChunkScheduler<VoxelStreamResident>({
    limits: {
      maxConcurrentJobs: 2,
      maxQueuedJobs: 256,
      maxResidentChunks: 128,
      maxChunkPayloadBytes: 64 * 1024 * 1024,
    },
    releaseResident: (resident) => resident.release(),
  });
  const pending = new Set<string>();
  const radius = 2;
  const verticalRadius = 1;
  let disposed = false;
  let latestPosition: readonly [number, number, number] | null = null;

  const syncColliders = () => {
    if (!enableColliders) return;
    physics.colliders.sync(
      createVoxelChunkColliderInputs(
        [...sourceCache.values()],
        project.settings.voxelSize,
        project.settings.chunkDimensions,
        activeColliderKeys,
      ),
    );
  };

  const getSourceChunk = (coordinate: ChunkCoordinate3): Promise<PlayerVoxelChunkSnapshot> => {
    const key = chunkKey(coordinate.x, coordinate.y, coordinate.z);
    const cached = readVoxelSourceCache(sourceCache, key);
    if (cached) return Promise.resolve(cached);
    const existing = sourcePending.get(key);
    if (existing) return existing;
    const request = loadChunk(coordinate).then((chunk) => {
      if (!disposed && sourceKeepKeys.has(key)) writeVoxelSourceCache(sourceCache, key, chunk);
      return chunk;
    });
    sourcePending.set(key, request);
    void request.finally(() => sourcePending.delete(key)).catch(() => undefined);
    return request;
  };

  const pruneSourceCache = (keepKeys: ReadonlySet<string>) => {
    pruneVoxelSourceCache(sourceCache, keepKeys);
  };

  const update = (position: readonly [number, number, number]) => {
    if (disposed) return;
    latestPosition = [...position];
    const desired = selectVoxelStreamingWindow(
      candidates.map((candidate) => ({ coordinate: candidate.coordinate, value: candidate })),
      position,
      project.settings.voxelSize,
      project.settings.chunkDimensions,
      radius,
      verticalRadius,
    );
    const desiredKeys = new Set(
      desired.map(({ coordinate }) => chunkKey(coordinate.x, coordinate.y, coordinate.z)),
    );
    activeColliderKeys.clear();
    for (const key of desiredKeys) activeColliderKeys.add(key);
    sourceKeepKeys = new Set(desiredKeys);
    for (const entry of desired) {
      const { x, y, z } = entry.coordinate;
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const key = chunkKey(x + dx!, y + dy!, z + dz!);
        if (candidateByKey.has(key)) sourceKeepKeys.add(key);
      }
    }
    pruneSourceCache(sourceKeepKeys);
    syncColliders();

    for (const candidate of candidates) {
      const key = chunkKey(candidate.coordinate.x, candidate.coordinate.y, candidate.coordinate.z);
      if (!desiredKeys.has(key)) scheduler.evict(candidate.coordinate);
    }
    for (const entry of desired) {
      const key = chunkKey(entry.coordinate.x, entry.coordinate.y, entry.coordinate.z);
      if (pending.has(key) || scheduler.getResident(entry.coordinate)) continue;
      pending.add(key);
      let wasCancelled = false;
      void scheduler
        .request({
          coordinate: entry.coordinate,
          revision: entry.value.revision,
          priority: -entry.distanceSquared,
          run: async (signal) => {
            const chunk = await getSourceChunk(entry.coordinate);
            if (signal.aborted) {
              throw new Error('WORLD_JOB_CANCELLED');
            }
            const { x, y, z } = chunk.coordinate;
            const neighbor = async (dx: number, dy: number, dz: number) => {
              const coordinate = { x: x + dx, y: y + dy, z: z + dz };
              if (!candidateByKey.has(chunkKey(coordinate.x, coordinate.y, coordinate.z))) {
                return undefined;
              }
              return getSourceChunk(coordinate);
            };
            // A corrupt or unavailable adjacent payload must not prevent this
            // valid chunk from meshing. If the failed neighbor is itself in the
            // active window, its own scheduled job will report that failure.
            const neighborResults = await Promise.allSettled([
              neighbor(1, 0, 0),
              neighbor(-1, 0, 0),
              neighbor(0, 1, 0),
              neighbor(0, -1, 0),
              neighbor(0, 0, 1),
              neighbor(0, 0, -1),
            ]);
            if (signal.aborted) throw new Error('WORLD_JOB_CANCELLED');
            const [positiveX, negativeX, positiveY, negativeY, positiveZ, negativeZ] =
              fulfilledVoxelNeighbors(neighborResults);
            const neighbors = {
              ...(positiveX ? { positiveX } : {}),
              ...(negativeX ? { negativeX } : {}),
              ...(positiveY ? { positiveY } : {}),
              ...(negativeY ? { negativeY } : {}),
              ...(positiveZ ? { positiveZ } : {}),
              ...(negativeZ ? { negativeZ } : {}),
            };
            syncColliders();
            const mesh = await meshVoxelChunkAsync(
              chunk,
              neighbors,
              project.settings.voxelSize,
              signal,
            );
            completedMeshes.set(key, mesh);
            const byteLength = mesh.parts.reduce(
              (total, part) =>
                total +
                part.geometry.positions.byteLength +
                part.geometry.normals.byteLength +
                (part.geometry.uvs?.byteLength ?? 0) +
                part.geometry.indices.byteLength,
              0,
            );
            let released = false;
            return {
              value: {
                byteLength,
                release: () => {
                  if (released) return;
                  released = true;
                  const entities = renderEntities.get(key) ?? [];
                  for (const entity of entities) runtime.world.destroyEntity(entity);
                  renderEntities.delete(key);
                  completedMeshes.delete(key);
                },
              },
              byteLength,
            };
          },
        })
        .then((resident) => {
          if (disposed || scheduler.getResident(entry.coordinate)?.value !== resident) return;
          const chunk = sourceCache.get(key);
          if (!chunk) return;
          const origin: [number, number, number] = [
            chunk.coordinate.x * project.settings.chunkDimensions.x * project.settings.voxelSize,
            chunk.coordinate.y * project.settings.chunkDimensions.y * project.settings.voxelSize,
            chunk.coordinate.z * project.settings.chunkDimensions.z * project.settings.voxelSize,
          ];
          const entities: ReturnType<typeof runtime.world.createEntity>[] = [];
          const mesh = completedMeshes.get(key);
          if (!mesh) return;
          for (const part of mesh.parts) {
            const style = resolveVoxelMaterialStyle(
              part.material,
              project.document.assets as readonly AssetRecord[],
              project.document.assetPayloads ?? [],
            );
            entities.push(
              addMeshRenderable(origin, part.geometry, {
                ...createDefaultMaterial(style.color),
                roughness: style.roughness,
                ...(style.baseColorTexture ? { baseColorTexture: style.baseColorTexture } : {}),
              }),
            );
          }
          renderEntities.set(key, entities);
        })
        .catch((error: unknown) => {
          if (!scheduler.getResident(entry.coordinate)) completedMeshes.delete(key);
          wasCancelled =
            error instanceof Error &&
            (('code' in error && error.code === 'WORLD_JOB_CANCELLED') ||
              error.message === 'WORLD_JOB_CANCELLED');
          if (!wasCancelled && !disposed) {
            setProjectStatus(
              `Voxel chunk ${key} failed to stream: ${error instanceof Error ? error.message : String(error)}`,
              true,
            );
          }
        })
        .finally(() => {
          pending.delete(key);
          if (wasCancelled && !disposed && latestPosition) update(latestPosition);
        });
    }
  };

  const completedMeshes = new Map<string, Awaited<ReturnType<typeof meshVoxelChunkAsync>>>();
  return {
    update,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
      for (const entities of renderEntities.values()) {
        for (const entity of entities) runtime.world.destroyEntity(entity);
      }
      renderEntities.clear();
      completedMeshes.clear();
      sourceCache.clear();
      sourcePending.clear();
      sourceKeepKeys.clear();
      activeColliderKeys.clear();
      if (enableColliders) physics.colliders.sync([]);
    },
  };
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
    projectDirectorySelected = true;
    setProjectProgress(8, 'Reading project manifest and assets');
    await yieldToBrowser();
    const project = await openVoxelWorldProject(new BrowserProjectFileStore(directory));
    setProjectProgress(52, 'Preparing scene entities and GLB models');
    await yieldToBrowser();
    const world = await prepareWorldEntities(project.document);
    setProjectProgress(68, 'Preparing voxel streaming window');
    await yieldToBrowser();
    const voxelStreamCandidates = project.chunks;

    // Physics and render data are both made resident only for the camera window.
    setProjectProgress(80, 'Preparing streamed collision');
    await yieldToBrowser();
    const physics = await physicsReady;
    if (!physics) throw new Error('Rapier physics world is unavailable');

    // Commit after the manifest and non-voxel assets are validated. Voxel payloads
    // remain lazy and surface integrity/read failures when their chunks are requested.
    streamAnchor = null;
    camera = createDefaultCamera();
    for (const entity of sampleEntities) runtime.world.destroyEntity(entity);
    voxelStream?.dispose();
    voxelStream = null;
    for (const entity of activeProjectEntities) runtime.world.destroyEntity(entity);
    activeProjectEntities.length = 0;
    activeAnimations.splice(0, activeAnimations.length, ...world.animations);
    for (const source of activeAudioSources) source.voice?.dispose();
    activeAudioSources.length = 0;
    for (const source of world.audioSources) {
      activeAudioSources.push(addAudioSourceRuntimeEntity(source));
    }
    if (audioTestButton) {
      audioTestButton.textContent =
        activeAudioSources.length > 0 ? 'Enable project audio' : 'Play spatial audio test';
    }
    if (audioRuntime.active && activeAudioSources.length > 0) {
      void activateProjectAudioSources();
    }
    for (const entity of world.prepared) {
      activeProjectEntities.push(
        addMeshRenderable(
          entity.position,
          entity.geometry,
          entity.material,
          entity.rotation,
          entity.scale,
          entity.skinning,
        ),
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
      // The current Player camera is a fixed orbit camera without navigation controls;
      // stream around its look-at target rather than its intentionally distant eye.
      streamAnchor = target;
    }
    setProjectProgress(88, 'Applying loaded scene');
    await yieldToBrowser();
    const chunkCount = project.chunks.length;
    const stream = createVoxelStream(voxelStreamCandidates, project.loadChunk, project, physics);
    voxelStream = stream;
    stream.update(streamAnchor ?? camera.position);
    const meshCount = world.prepared.length;
    setProjectProgress(100, 'Project loaded');
    setProjectStatus(
      `Loaded “${project.document.world.name}” · ${chunkCount} voxel chunks available for streaming · ${meshCount} non-voxel mesh parts` +
        ` · streamed voxel collision enabled` +
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
let streamAnchor: readonly [number, number, number] | null = null;

async function preloadSampleVoxelScene(): Promise<void> {
  try {
    if (new URLSearchParams(window.location.search).get('fixture') === 'fox') {
      setProjectProgress(8, 'Loading Khronos Fox animation fixture');
      await yieldToBrowser();
      const response = await fetch(foxFixtureUrl);
      if (!response.ok) throw new Error(`Fox fixture request failed: ${response.status}`);
      const fixtureDocument = {
        assets: [
          {
            id: 'fox-fixture',
            name: 'Khronos Fox',
            kind: 'model',
            uri: 'fixtures/Fox.glb',
            contentHash: '0'.repeat(64),
            importer: { id: glbImporter.id, version: '0.1.0', settings: {} },
            dependencies: [],
            metadata: {},
          },
        ],
        assetPayloads: [
          {
            assetId: 'fox-fixture',
            encoding: 'base64',
            data: encodeBase64(await response.arrayBuffer()),
          },
        ],
        world: {
          name: 'Khronos Fox Animation Fixture',
          entities: [
            {
              id: 'fox-fixture',
              components: {
                Transform: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0, 1],
                  scale: [1, 1, 1],
                },
                MeshRenderer: { primitive: 'GLB', assetId: 'fox-fixture' },
              },
            },
          ],
        },
      } as unknown as WorldDocument;
      const world = await prepareWorldEntities(fixtureDocument);
      if (pageDisposed || projectDirectorySelected) return;
      for (const entity of sampleEntities) runtime.world.destroyEntity(entity);
      voxelStream?.dispose();
      voxelStream = null;
      for (const entity of activeProjectEntities) runtime.world.destroyEntity(entity);
      activeProjectEntities.length = 0;
      activeAnimations.splice(0, activeAnimations.length, ...world.animations);
      for (const source of activeAudioSources) source.voice?.dispose();
      activeAudioSources.length = 0;
      for (const source of world.audioSources) {
        activeAudioSources.push(addAudioSourceRuntimeEntity(source));
      }
      if (audioTestButton) {
        audioTestButton.textContent =
          activeAudioSources.length > 0 ? 'Enable project audio' : 'Play spatial audio test';
      }
      if (audioRuntime.active && activeAudioSources.length > 0) {
        void activateProjectAudioSources();
      }
      for (const entity of world.prepared) {
        activeProjectEntities.push(
          addMeshRenderable(
            entity.position,
            entity.geometry,
            entity.material,
            entity.rotation,
            entity.scale,
            entity.skinning,
          ),
        );
      }
      const target: readonly [number, number, number] = [0, 0.8, 0];
      const position: readonly [number, number, number] = [3, 2, 3];
      camera = {
        ...createDefaultCamera(),
        position,
        rotation: lookAtQuaternion(position, target),
      };
      setProjectProgress(100, 'Fox fixture ready');
      setProjectStatus(
        `Fox animation fixture ready · ${world.prepared.length} mesh parts · ${world.animations.length} animation instances · press [ or ] to cross-fade clips`,
      );
      return;
    }
    setProjectProgress(8, 'Preparing built-in voxel test scene');
    await yieldToBrowser();
    const sample = createSampleVoxelScene();
    const physics = await physicsReady;
    if (!physics || pageDisposed || projectDirectorySelected) return;
    for (const entity of sampleEntities) runtime.world.destroyEntity(entity);
    voxelStream?.dispose();
    voxelStream = createVoxelStream(sample.candidates, sample.loadChunk, sample.project, physics, {
      enableColliders: false,
    });
    const target: readonly [number, number, number] = [8, 0, 0];
    camera = {
      ...createDefaultCamera(),
      position: [120, 85, 120],
      rotation: lookAtQuaternion([120, 85, 120], target),
    };
    streamAnchor = target;
    voxelStream.update(target);
    setProjectProgress(100, 'Test scene ready');
    setProjectStatus(
      'Voxel test scene ready · 63 chunks available · WASD/RF to stream · Open project folder to load your world',
    );
  } catch (error) {
    setProjectProgress(0, '', false);
    setProjectStatus(
      `Could not prepare voxel test scene: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    if (progressValue?.textContent === '100%') {
      window.setTimeout(() => setProjectProgress(100, 'Test scene ready', false), 650);
    }
  }
}
void preloadSampleVoxelScene();

const cameraPanKeys = new Set<string>();
window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable="true"]'))
  ) {
    return;
  }
  if (['w', 'a', 's', 'd', 'r', 'f'].includes(event.key.toLowerCase())) {
    cameraPanKeys.add(event.key.toLowerCase());
  }
});
window.addEventListener('keyup', (event) => cameraPanKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => cameraPanKeys.clear());
window.addEventListener('keydown', (event) => {
  if (event.key !== '[' && event.key !== ']') return;
  const activeClipNames: string[] = [];
  for (const animation of activeAnimations) {
    if (animation.clipNames.length < 2) continue;
    const direction = event.key === ']' ? 1 : -1;
    animation.clipIndex =
      (animation.clipIndex + direction + animation.clipNames.length) % animation.clipNames.length;
    const clipName = animation.clipNames[animation.clipIndex]!;
    animation.player.crossFadeTo(clipName, 0.35);
    activeClipNames.push(clipName);
  }
  if (activeClipNames.length > 0) {
    setProjectStatus(
      `Cross-fading to ${activeClipNames.join(', ')} · press [ or ] to switch clips`,
    );
  }
});
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
  for (const animation of activeAnimations) {
    animation.player.update(delta);
    const pose = animation.player.pose;
    for (const binding of animation.bindings) {
      const matrices = evaluateSkinningMatrices(
        pose,
        animation.parents,
        binding.skin,
        binding.meshNodeIndex,
      );
      for (const palette of binding.palettes) palette.set(matrices);
    }
  }
  if (streamAnchor && cameraPanKeys.size > 0 && delta > 0) {
    const distance = Math.min(delta, 0.1) * 24;
    const dx = (Number(cameraPanKeys.has('d')) - Number(cameraPanKeys.has('a'))) * distance;
    const dy = (Number(cameraPanKeys.has('r')) - Number(cameraPanKeys.has('f'))) * distance;
    const dz = (Number(cameraPanKeys.has('s')) - Number(cameraPanKeys.has('w'))) * distance;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      streamAnchor = [streamAnchor[0] + dx, streamAnchor[1] + dy, streamAnchor[2] + dz];
      camera = {
        ...camera,
        position: [camera.position[0] + dx, camera.position[1] + dy, camera.position[2] + dz],
      };
      voxelStream?.update(streamAnchor);
    }
  }

  // Keep the audio listener synchronized after camera input has been applied.
  audioRuntime.setListener({ position: camera.position, orientation: camera.rotation });
  if (import.meta.env.DEV) {
    const debugWindow = window as Window & {
      __playerAudioListenerPosition?: readonly [number, number, number];
    };
    debugWindow.__playerAudioListenerPosition = [...camera.position];
  }

  // Keep Rapier on a bounded fixed timestep; large tab-resume deltas are clamped.
  physicsAccumulator += Math.min(delta, maxPhysicsFrameDelta);
  while (physicsAccumulator >= physicsFixedStep) {
    physicsWorld?.step(physicsFixedStep);
    physicsAccumulator -= physicsFixedStep;
  }

  const objects: RenderObject[] = [];
  runtime.world.query(Renderable).forEach((entity, renderableValue) => {
    const renderable = renderableValue as {
      geometry: MeshData;
      material: MaterialDescriptor;
      skinning?: RenderSkinning;
    };
    const worldMatrix = runtime.hierarchy.getWorldMatrix(entity);
    if (!worldMatrix) return;
    objects.push({
      id: entity,
      geometry: renderable.geometry,
      material: renderable.material,
      ...(renderable.skinning ? { skinning: renderable.skinning } : {}),
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
  activeAnimations.length = 0;
  audioTestVoice?.dispose();
  audioRuntime.dispose();
  voxelStream?.dispose();
  voxelStream = null;
  voxelColliderSet?.dispose();
  physicsWorld?.dispose();
  // Release WebGL resources synchronously during pagehide; EngineHost disposal
  // remains responsible for the rest of the service lifecycle.
  renderer.dispose();
  void engine.dispose();
};
window.addEventListener('pagehide', onPageHide, { once: true });
animationFrame = window.requestAnimationFrame(renderFrame);
