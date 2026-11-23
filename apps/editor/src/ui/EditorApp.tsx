import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssetImportService,
  AssetImportScope,
  AssetRegistry,
  AssetResourceCache,
  type AssetResourceLease,
  type ImportedAsset,
  type AssetId,
  type AssetKind,
  type RegisterAssetInput,
} from '@engine/assets';
import type { Matrix4 as Matrix4Type } from 'three';
import type { GlbAsset } from '@engine/gltf-importer';
import type { WorldAssetPayload } from '@engine/serialization';
import {
  loadVoxelWorldProject,
  loadDirectoryProject as loadStoredDirectoryProject,
  saveVoxelWorldProject,
  VOXEL_WORLD_EXTENSION_KEY,
  type VoxelWorldSettings,
  type VoxelChunkSnapshot,
} from '@engine/project-storage';
import { EditorHistory } from './EditorHistory.js';
import { resolveVoxelBrushCell } from './voxelBrush.js';
import { readPbrMaterialState } from './materialValidation.js';
import { WorkerGlbImporter } from '../workers/WorkerGlbImporter.js';
import {
  CURRENT_WORLD_SCHEMA_VERSION,
  parseWorld,
  serializeWorld,
  type WorldDocument,
} from '@engine/serialization';
import {
  createBoxGeometry,
  createCylinderGeometry,
  createPlaneGeometry,
  createUvSphereGeometry,
  validateMeshData,
  type MeshData,
} from '@engine/geometry';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
} from '@engine/renderer/contracts';
import type { RenderObject, TextureSource, Vec3 } from '@engine/renderer/contracts';
import {
  BUILTIN_VOXEL_MATERIALS,
  createVoxelChunkSnapshot,
  editVoxelChunk,
  getBuiltinVoxelMaterial,
  meshVoxelChunk,
} from '@engine/voxel';
import { createChunkCoordinate } from '@engine/world';
import type { ThreeWebGLRendererAdapter } from '@engine/renderer';
import { EditorRecoveryStore } from '../project/EditorRecoveryStore.js';
import {
  BrowserProjectFileStore,
  loadDirectoryProject,
  type DirectoryHandleLike,
} from '../project/ProjectAssetStore.js';

type TransformNumberInputProps = {
  readonly value: number;
  readonly label: string;
  readonly onCommit: (value: string) => void;
};

/** Keeps an editable text draft so clearing a numeric field does not become zero. */
function TransformNumberInput({ value, label, onCommit }: TransformNumberInputProps) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))));

  useEffect(() => {
    setDraft(String(Number(value.toFixed(2))));
  }, [value]);

  const commit = () => {
    if (draft.trim() === '') {
      setDraft(String(Number(value.toFixed(2))));
      return;
    }
    if (!Number.isFinite(Number(draft))) {
      setDraft(String(Number(value.toFixed(2))));
      return;
    }
    onCommit(draft);
  };

  return (
    <input
      aria-label={label}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type Primitive = 'Box' | 'Sphere' | 'Plane' | 'Cylinder';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    readonly mode?: 'read' | 'readwrite';
  }) => Promise<DirectoryHandleLike>;
}
type TransformMode = 'position' | 'rotation' | 'scale';
type DiagnosticEntry = {
  id: number;
  time: string;
  level: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  details?: string;
};
type SceneEntity = Extract<RenderObject, { readonly position: Vec3 }> & {
  readonly name: string;
  readonly primitive: Primitive | 'GLB';
  readonly assetId?: AssetId;
  readonly rotationEuler?: readonly [number, number, number];
};
const geometryFor: Record<Primitive, () => MeshData> = {
  Box: () => createBoxGeometry(),
  Sphere: () => createUvSphereGeometry(),
  Plane: () => createPlaneGeometry(4, 4, 1, 1),
  Cylinder: () => createCylinderGeometry(),
};
const MAX_VOXEL_TEXTURE_BYTES = 16 * 1024 * 1024;

const ASSET_KINDS: readonly AssetKind[] = [
  'model',
  'mesh',
  'material',
  'texture',
  'audio',
  'animation',
  'environment',
  'other',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAssetMetadata(
  value: unknown,
  path: string,
): Readonly<Record<string, string | number | boolean>> {
  if (!isRecord(value)) throw new Error(`Invalid asset metadata at ${path}`);
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== 'string' &&
      typeof item !== 'boolean' &&
      !(typeof item === 'number' && Number.isFinite(item))
    ) {
      throw new Error(`Invalid asset metadata value at ${path}.${key}`);
    }
  }
  return value as Readonly<Record<string, string | number | boolean>>;
}

function parseAssetRecord(value: unknown, index: number): RegisterAssetInput {
  const path = `$.assets[${index}]`;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error(`Invalid asset identity at ${path}`);
  }
  if (typeof value.kind !== 'string' || !ASSET_KINDS.includes(value.kind as AssetKind)) {
    throw new Error(`Invalid asset kind at ${path}.kind`);
  }
  if (typeof value.uri !== 'string' || typeof value.contentHash !== 'string') {
    throw new Error(`Invalid asset URI or content hash at ${path}`);
  }
  if (
    !isRecord(value.importer) ||
    typeof value.importer.id !== 'string' ||
    typeof value.importer.version !== 'string'
  ) {
    throw new Error(`Invalid asset importer at ${path}.importer`);
  }
  if (
    !Array.isArray(value.dependencies) ||
    !value.dependencies.every((item) => typeof item === 'string')
  ) {
    throw new Error(`Invalid asset dependencies at ${path}.dependencies`);
  }
  return {
    id: value.id as AssetId,
    name: value.name,
    kind: value.kind as AssetKind,
    uri: value.uri,
    contentHash: value.contentHash,
    importer: {
      id: value.importer.id,
      version: value.importer.version,
      settings: readAssetMetadata(value.importer.settings, `${path}.importer.settings`),
    },
    dependencies: value.dependencies as AssetId[],
    metadata: readAssetMetadata(value.metadata, `${path}.metadata`),
  };
}

function mergeAssetRegistry(current: AssetRegistry, serialized: readonly unknown[]): AssetRegistry {
  const merged = new AssetRegistry();
  for (const asset of current.list()) merged.register(asset);
  const pending = serialized.map(parseAssetRecord);
  while (pending.length) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const asset = pending[index]!;
      const existing = merged.get(asset.id!);
      if (existing) {
        if (existing.contentHash !== asset.contentHash || existing.kind !== asset.kind) {
          throw new Error(`World asset identity conflicts with the current project: ${asset.id}`);
        }
        pending.splice(index, 1);
        progressed = true;
      } else if ((asset.dependencies ?? []).every((dependency) => merged.has(dependency))) {
        merged.register(asset);
        pending.splice(index, 1);
        progressed = true;
      }
    }
    if (!progressed)
      throw new Error('World assets contain missing dependencies or a dependency cycle');
  }
  return merged;
}

async function sha256(source: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', source);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

function encodeBase64(source: ArrayBuffer): string {
  const bytes = new Uint8Array(source);
  const chunks: string[] = [];
  // Encode bounded, 3-byte-aligned slices to avoid a model-sized binary string.
  const chunkSize = 0x6000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return chunks.join('');
}

function decodeBase64(source: string): ArrayBuffer {
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function EditorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLOutputElement>(null);
  const renderedFrameCountRef = useRef(0);
  const rendererRef = useRef<ThreeWebGLRendererAdapter | null>(null);
  const [entities, setEntities] = useState<SceneEntity[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const entitiesRef = useRef(entities);
  const [voxelChunks, setVoxelChunks] = useState<readonly VoxelChunkSnapshot[]>([]);
  const voxelChunksRef = useRef<readonly VoxelChunkSnapshot[]>(voxelChunks);
  const history = useRef(
    new EditorHistory<{ entities: SceneEntity[]; voxelChunks: readonly VoxelChunkSnapshot[] }>(100),
  );
  const [historyVersion, setHistoryVersion] = useState(0);
  void historyVersion;

  const commitVoxelChunks = (next: readonly VoxelChunkSnapshot[]) => {
    history.current.commit({ entities: entitiesRef.current, voxelChunks: voxelChunksRef.current });
    voxelChunksRef.current = next;
    setVoxelChunks(next);
    setIsDirty(true);
    setHistoryVersion((version) => version + 1);
  };

  const commitEntities = (next: SceneEntity[]) => {
    history.current.commit({ entities: entitiesRef.current, voxelChunks: voxelChunksRef.current });
    entitiesRef.current = next;
    setEntities(next);
    setIsDirty(true);
    setHistoryVersion((version) => version + 1);
  };

  const undo = useCallback(() => {
    const previous = history.current.undo({
      entities: entitiesRef.current,
      voxelChunks: voxelChunksRef.current,
    });
    if (!previous) return;
    entitiesRef.current = previous.entities;
    voxelChunksRef.current = previous.voxelChunks;
    setEntities(previous.entities);
    setVoxelChunks(previous.voxelChunks);
    setIsDirty(true);
    setHistoryVersion((version) => version + 1);
    setSelectedId((current) =>
      previous.entities.some((entity) => entity.id === current)
        ? current
        : (previous.entities[0]?.id ?? ''),
    );
    setSelectedVoxelChunkKey((current) => {
      const exists = previous.voxelChunks.some(
        (chunk) => `${chunk.coordinate.x},${chunk.coordinate.y},${chunk.coordinate.z}` === current,
      );
      const first = previous.voxelChunks[0];
      return exists
        ? current
        : first
          ? `${first.coordinate.x},${first.coordinate.y},${first.coordinate.z}`
          : null;
    });
  }, []);

  const redo = useCallback(() => {
    const next = history.current.redo({
      entities: entitiesRef.current,
      voxelChunks: voxelChunksRef.current,
    });
    if (!next) return;
    entitiesRef.current = next.entities;
    voxelChunksRef.current = next.voxelChunks;
    setEntities(next.entities);
    setVoxelChunks(next.voxelChunks);
    setIsDirty(true);
    setHistoryVersion((version) => version + 1);
    setSelectedId((current) =>
      next.entities.some((entity) => entity.id === current)
        ? current
        : (next.entities[0]?.id ?? ''),
    );
    setSelectedVoxelChunkKey((current) => {
      const exists = next.voxelChunks.some(
        (chunk) => `${chunk.coordinate.x},${chunk.coordinate.y},${chunk.coordinate.z}` === current,
      );
      const first = next.voxelChunks[0];
      return exists
        ? current
        : first
          ? `${first.coordinate.x},${first.coordinate.y},${first.coordinate.z}`
          : null;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (editingText || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === 'z') {
        event.preventDefault();
        undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);
  const [selectedId, setSelectedId] = useState('');
  const [rendererError, setRendererError] = useState('');
  const [rendererStatus, setRendererStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const pushDiagnostic = useCallback((entry: Omit<DiagnosticEntry, 'id' | 'time'>) => {
    setDiagnostics((current) =>
      [
        {
          ...entry,
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString(),
        },
        ...current,
      ].slice(0, 200),
    );
  }, []);
  const [worldName, setWorldName] = useState('Untitled World');
  const [voxelWorldSettings, setVoxelWorldSettings] = useState<VoxelWorldSettings>({
    voxelSize: 1,
    chunkDimensions: { x: 16, y: 16, z: 16 },
  });
  const [selectedVoxelChunkKey, setSelectedVoxelChunkKey] = useState<string | null>(null);
  const [voxelCell, setVoxelCell] = useState({ x: 0, y: 1, z: 0 });
  const [voxelChunkTarget, setVoxelChunkTarget] = useState({
    x: 0,
    y: 0,
    z: 0,
  });
  const [voxelMaterial, setVoxelMaterial] = useState('builtin:grass');
  const [voxelAssetMaterials, setVoxelAssetMaterials] = useState<
    readonly {
      assetId: string;
      name: string;
      color: number;
      roughness: number;
      textureAssetId?: string;
    }[]
  >([]);
  const [newVoxelMaterialName, setNewVoxelMaterialName] = useState('Custom Material');
  const [newVoxelMaterialColor, setNewVoxelMaterialColor] = useState('#a87952');
  const [newVoxelMaterialRoughness, setNewVoxelMaterialRoughness] = useState('0.9');
  const [newVoxelMaterialTexture, setNewVoxelMaterialTexture] = useState<File | null>(null);
  const [isVoxelMaterialDialogOpen, setIsVoxelMaterialDialogOpen] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const recoveryStoreRef = useRef<EditorRecoveryStore | null>(null);
  const [voxelBrushMode, setVoxelBrushMode] = useState<'paint' | 'erase'>('paint');
  const [cameraTool, setCameraTool] = useState<'select' | 'pan' | 'rotate'>('select');
  const [brushPreview, setBrushPreview] = useState<{
    chunkKey: string;
    cell: { x: number; y: number; z: number };
    mode: 'paint' | 'erase';
  } | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectDirectoryRef = useRef<DirectoryHandleLike | null>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const assetRegistryRef = useRef(new AssetRegistry());
  const assetImportServiceRef = useRef(new AssetImportService());
  const glbImporterRegisteredRef = useRef(false);
  const assetPayloadsRef = useRef(new Map<AssetId, WorldAssetPayload>());
  const assetResourceCacheRef = useRef(new AssetResourceCache<ImportedAsset<GlbAsset>>());
  const assetResourceLeasesRef = useRef<AssetResourceLease<ImportedAsset<GlbAsset>>[]>([]);
  const activeGlbImportControllersRef = useRef(new AssetImportScope());
  useEffect(
    () => () => {
      activeGlbImportControllersRef.current.abortAll('Editor unmounted');
      for (const lease of assetResourceLeasesRef.current) lease.release();
      assetResourceLeasesRef.current = [];
    },
    [],
  );
  const [camera, setCamera] = useState(() => createDefaultCamera());
  const [transformMode, setTransformMode] = useState<TransformMode>('position');
  const [transformAxis, setTransformAxis] = useState(0);
  const [isTransformPadCollapsed, setIsTransformPadCollapsed] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistanceRef = useRef<number | null>(null);
  const multiTouchRef = useRef(false);
  const selected = entities.find((entity) => entity.id === selectedId) ?? null;
  const selectedVoxelChunk =
    voxelChunks.find(
      (chunk) =>
        chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z ===
        selectedVoxelChunkKey,
    ) ?? null;
  useEffect(() => {
    if (selectedVoxelChunk) setVoxelChunkTarget({ ...selectedVoxelChunk.coordinate });
  }, [selectedVoxelChunk]);

  const voxelPaletteUsage = useMemo(() => {
    if (!selectedVoxelChunk) return [];
    const counts = new Array<number>(selectedVoxelChunk.palette.length).fill(0);
    for (const value of selectedVoxelChunk.copyCells()) {
      if (value > 0) counts[value - 1] = (counts[value - 1] ?? 0) + 1;
    }
    return counts;
  }, [selectedVoxelChunk]);

  const voxelRenderObjects = useMemo<RenderObject[]>(() => {
    const byCoordinate = new Map(
      voxelChunks.map((chunk) => [
        chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z,
        chunk,
      ]),
    );
    return voxelChunks.flatMap((chunk) => {
      const { x, y, z } = chunk.coordinate;
      const neighbor = (dx: number, dy: number, dz: number) =>
        byCoordinate.get(x + dx + ',' + (y + dy) + ',' + (z + dz));
      const neighbors = {
        ...(neighbor(1, 0, 0) ? { positiveX: neighbor(1, 0, 0)! } : {}),
        ...(neighbor(-1, 0, 0) ? { negativeX: neighbor(-1, 0, 0)! } : {}),
        ...(neighbor(0, 1, 0) ? { positiveY: neighbor(0, 1, 0)! } : {}),
        ...(neighbor(0, -1, 0) ? { negativeY: neighbor(0, -1, 0)! } : {}),
        ...(neighbor(0, 0, 1) ? { positiveZ: neighbor(0, 0, 1)! } : {}),
        ...(neighbor(0, 0, -1) ? { negativeZ: neighbor(0, 0, -1)! } : {}),
      };
      const mesh = meshVoxelChunk(chunk, neighbors, voxelWorldSettings.voxelSize);
      const position: Vec3 = [
        x * voxelWorldSettings.chunkDimensions.x * voxelWorldSettings.voxelSize,
        y * voxelWorldSettings.chunkDimensions.y * voxelWorldSettings.voxelSize,
        z * voxelWorldSettings.chunkDimensions.z * voxelWorldSettings.voxelSize,
      ];
      return mesh.parts.map((part, index) => ({
        id: 'voxel:' + x + ',' + y + ',' + z + ':' + index,
        geometry: part.geometry,
        material: (() => {
          const builtin =
            part.material.kind === 'builtin'
              ? getBuiltinVoxelMaterial(part.material.key)
              : undefined;
          const assetMaterial =
            part.material.kind === 'asset'
              ? assetRegistryRef.current.get(part.material.assetId as AssetId)
              : undefined;
          const assetColor = assetMaterial?.metadata.color;
          const assetRoughness = assetMaterial?.metadata.roughness;
          const textureAssetId = assetMaterial?.metadata.baseColorTextureAssetId;
          const textureRecord =
            typeof textureAssetId === 'string'
              ? assetRegistryRef.current.get(textureAssetId as AssetId)
              : undefined;
          const texturePayload =
            typeof textureAssetId === 'string'
              ? assetPayloadsRef.current.get(textureAssetId as AssetId)
              : undefined;
          const baseColorTexture =
            textureRecord?.kind === 'texture' &&
            texturePayload &&
            (texturePayload.mimeType === 'image/png' ||
              texturePayload.mimeType === 'image/jpeg' ||
              texturePayload.mimeType === 'image/webp')
              ? {
                  assetId: textureRecord.id,
                  cacheKey: textureRecord.contentHash,
                  mimeType: texturePayload.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
                  data: new Uint8Array(decodeBase64(texturePayload.data)),
                }
              : undefined;
          return {
            ...createDefaultMaterial(
              builtin?.color ?? (typeof assetColor === 'number' ? assetColor : 0x8995a5),
            ),
            ...(builtin ? { roughness: builtin.roughness } : {}),
            ...(typeof assetRoughness === 'number' ? { roughness: assetRoughness } : {}),
            ...(baseColorTexture ? { baseColorTexture } : {}),
          };
        })(),
        position,
        rotation: [0, 0, 0, 1] as const,
        scale: [1, 1, 1] as const,
      }));
    });
  }, [voxelChunks, voxelWorldSettings, voxelAssetMaterials]);
  const brushPreviewObject = useMemo<RenderObject | null>(() => {
    if (!brushPreview || cameraTool !== 'select') return null;
    const chunk = voxelChunks.find(
      (candidate) =>
        [candidate.coordinate.x, candidate.coordinate.y, candidate.coordinate.z].join(',') ===
        brushPreview.chunkKey,
    );
    if (!chunk) return null;
    const size = voxelWorldSettings.voxelSize;
    const color = brushPreview.mode === 'paint' ? 0x66d9a8 : 0xff766f;
    return {
      id: '__voxel-brush-preview__',
      geometry: createBoxGeometry(size * 0.94, size * 0.94, size * 0.94),
      material: {
        ...createDefaultMaterial(color),
        opacity: 0.38,
        transparent: true,
        emissiveColor: color,
      },
      position: [
        (chunk.coordinate.x * voxelWorldSettings.chunkDimensions.x + brushPreview.cell.x + 0.5) *
          size,
        (chunk.coordinate.y * voxelWorldSettings.chunkDimensions.y + brushPreview.cell.y + 0.5) *
          size,
        (chunk.coordinate.z * voxelWorldSettings.chunkDimensions.z + brushPreview.cell.z + 0.5) *
          size,
      ],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
  }, [brushPreview, cameraTool, voxelChunks, voxelWorldSettings]);

  const renderObjects = useMemo(
    () => [...entities, ...voxelRenderObjects, ...(brushPreviewObject ? [brushPreviewObject] : [])],
    [entities, selectedId, voxelRenderObjects, brushPreviewObject],
  );
  const renderScene = useMemo(
    () => ({ camera, background: 0x151a23, objects: renderObjects }),
    [camera, renderObjects],
  );

  const renderSceneRef = useRef(renderScene);
  renderSceneRef.current = renderScene;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let renderer: ThreeWebGLRendererAdapter | null = null;
    let fpsTimer: number | null = null;
    void import('@engine/renderer')
      .then(({ ThreeWebGLRendererAdapter: Renderer }) => {
        if (disposed) return;
        renderer = new Renderer(canvas);
        canvas.dataset.renderer = renderer.capabilities.backend;
        rendererRef.current = renderer;
        const resize = () => {
          if (!renderer) return;
          const bounds = canvas.getBoundingClientRect();
          renderer.resize(bounds.width, bounds.height);
          renderer.render(renderSceneRef.current);
          renderedFrameCountRef.current += 1;
        };
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        let lastFpsSample = performance.now();
        fpsTimer = window.setInterval(() => {
          const now = performance.now();
          const elapsed = now - lastFpsSample;
          if (fpsRef.current)
            fpsRef.current.textContent = `FPS ${Math.round(
              (renderedFrameCountRef.current * 1000) / elapsed,
            )}`;
          renderedFrameCountRef.current = 0;
          lastFpsSample = now;
        }, 500);
        setRendererStatus('ready');
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        canvas.dataset.rendererError = message;
        setRendererError(message);
        setRendererStatus('error');
        pushDiagnostic({
          level: 'error',
          source: 'Renderer',
          message: 'WebGL2 renderer initialization failed',
          details: message,
        });
        console.error('WebGL2 renderer initialization failed', error);
      });
    return () => {
      disposed = true;
      if (fpsTimer !== null) window.clearInterval(fpsTimer);
      observer?.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
    };
    // Renderer lifetime is tied to the canvas; scene updates are handled below.
  }, [pushDiagnostic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    const bounds = canvas.getBoundingClientRect();
    renderer.resize(bounds.width, bounds.height);
    renderer.render(renderScene);
    renderedFrameCountRef.current += 1;
  }, [renderScene]);

  const addEntity = useCallback(
    (primitive: Primitive) => {
      const id = `entity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const count = entities.filter((item) => item.primitive === primitive).length;
      const entity: SceneEntity = {
        id,
        name: count ? `${primitive} ${count + 1}` : primitive,
        primitive,
        geometry: geometryFor[primitive](),
        material: createDefaultMaterial(
          primitive === 'Sphere'
            ? 0x80c8a0
            : primitive === 'Plane'
              ? 0xb4a0e8
              : primitive === 'Cylinder'
                ? 0xe6a66c
                : 0x6ea8fe,
        ),
        position: [entities.length * 1.25, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      };
      commitEntities([...entities, entity]);
      setSelectedId(id);
    },
    [entities],
  );

  const addVoxelChunk = () => {
    const occupied = new Set(
      voxelChunks.map(
        (chunk) => chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z,
      ),
    );
    let x = 0;
    while (occupied.has(x + ',0,0')) x += 1;
    // A chunk is an empty storage region, not a prebuilt terrain slab.
    // Built-in materials are shared library entries; cells start as air.
    const cells = new Uint16Array(16 * 16 * 16);
    const chunk = createVoxelChunkSnapshot({
      coordinate: createChunkCoordinate({ x, y: 0, z: 0 }),
      palette: [],
      cells,
    });
    commitVoxelChunks([...voxelChunksRef.current, chunk]);
    setSelectedVoxelChunkKey(x + ',0,0');
    setSelectedId('');
    setIsDirty(true);
    setIsAddMenuOpen(false);
  };

  const commitVoxelPalette = (
    palette: VoxelChunkSnapshot['palette'],
    remap: (value: number) => number,
  ) => {
    if (!selectedVoxelChunk || selectedVoxelChunk.revision === Number.MAX_SAFE_INTEGER) return;
    const cells = selectedVoxelChunk.copyCells();
    for (let index = 0; index < cells.length; index += 1) {
      cells[index] = remap(cells[index]!);
    }
    const snapshot = createVoxelChunkSnapshot({
      coordinate: selectedVoxelChunk.coordinate,
      revision: selectedVoxelChunk.revision + 1,
      palette,
      cells,
    });
    const chunkKey =
      selectedVoxelChunk.coordinate.x +
      ',' +
      selectedVoxelChunk.coordinate.y +
      ',' +
      selectedVoxelChunk.coordinate.z;
    commitVoxelChunks(
      voxelChunksRef.current.map((chunk) =>
        chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z === chunkKey
          ? snapshot
          : chunk,
      ),
    );
    pushDiagnostic({
      level: 'info',
      source: 'Voxel editor',
      message: 'Voxel material palette updated',
      details: 'Chunk ' + chunkKey + ', revision ' + snapshot.revision + '.',
    });
  };

  const moveVoxelPaletteEntry = (from: number, to: number) => {
    if (
      !selectedVoxelChunk ||
      from < 0 ||
      to < 0 ||
      from >= selectedVoxelChunk.palette.length ||
      to >= selectedVoxelChunk.palette.length ||
      from === to
    )
      return;
    const palette = [...selectedVoxelChunk.palette];
    const [entry] = palette.splice(from, 1);
    if (!entry) return;
    palette.splice(to, 0, entry);
    commitVoxelPalette(palette, (value) => {
      if (value === 0) return 0;
      const oldIndex = value - 1;
      const newIndex = palette.findIndex((item) => item === entry);
      if (oldIndex === from) return newIndex + 1;
      if (from < to && oldIndex > from && oldIndex <= to) return oldIndex;
      if (from > to && oldIndex >= to && oldIndex < from) return oldIndex + 2;
      return value;
    });
  };

  const removeVoxelPaletteEntry = (paletteIndex: number) => {
    if (
      !selectedVoxelChunk ||
      paletteIndex < 0 ||
      paletteIndex >= selectedVoxelChunk.palette.length
    ) {
      return;
    }
    const cells = selectedVoxelChunk.copyCells();
    const storedIndex = paletteIndex + 1;
    if (cells.some((value) => value === storedIndex)) return;
    const palette = selectedVoxelChunk.palette.filter((_, index) => index !== paletteIndex);
    commitVoxelPalette(palette, (value) => (value > storedIndex ? value - 1 : value));
  };

  const createVoxelMaterialAsset = async () => {
    const name = newVoxelMaterialName.trim();
    const roughness = Number(newVoxelMaterialRoughness);
    if (
      !name ||
      !/^#[0-9a-fA-F]{6}$/.test(newVoxelMaterialColor) ||
      !Number.isFinite(roughness) ||
      roughness < 0 ||
      roughness > 1
    ) {
      return;
    }
    const color = Number.parseInt(newVoxelMaterialColor.slice(1), 16);
    let textureAssetId: AssetId | undefined;
    if (newVoxelMaterialTexture) {
      const mimeType = newVoxelMaterialTexture.type;
      if (
        newVoxelMaterialTexture.size === 0 ||
        newVoxelMaterialTexture.size > MAX_VOXEL_TEXTURE_BYTES
      ) {
        pushDiagnostic({
          level: 'error',
          source: 'Voxel materials',
          message: 'Voxel texture size is outside the supported range',
          details: 'Choose a non-empty image no larger than 16 MiB.',
        });
        return;
      }
      if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp') {
        pushDiagnostic({
          level: 'error',
          source: 'Voxel materials',
          message: 'Unsupported voxel texture format',
          details: 'Choose a PNG, JPEG or WebP image.',
        });
        return;
      }
      const textureBuffer = await newVoxelMaterialTexture.arrayBuffer();
      const textureId = ('asset:voxel-texture-' + crypto.randomUUID()) as AssetId;
      const textureRecord = assetRegistryRef.current.register({
        id: textureId,
        name: name + ' Texture',
        kind: 'texture',
        uri: 'textures/voxel/' + textureId.slice('asset:'.length),
        contentHash: await sha256(textureBuffer),
        importer: { id: 'choreon.voxel-texture', version: '1', settings: {} },
        metadata: { role: 'voxel-texture', mimeType },
      });
      assetPayloadsRef.current.set(textureRecord.id, {
        assetId: textureRecord.id,
        mimeType,
        encoding: 'base64',
        data: encodeBase64(textureBuffer),
      });
      textureAssetId = textureRecord.id;
    }

    const assetId = ('asset:voxel-material-' + crypto.randomUUID()) as AssetId;
    const source = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        name,
        color,
        roughness,
        ...(textureAssetId ? { baseColorTextureAssetId: textureAssetId } : {}),
      }),
    );
    const sourceBuffer = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer;
    const contentHash = await sha256(sourceBuffer);
    const record = assetRegistryRef.current.register({
      id: assetId,
      name,
      kind: 'material',
      uri: 'materials/voxel/' + assetId.slice('asset:'.length) + '.json',
      contentHash,
      importer: { id: 'choreon.voxel-material', version: '1', settings: {} },
      dependencies: textureAssetId ? [textureAssetId] : [],
      metadata: {
        role: 'voxel-material',
        color,
        roughness,
        mimeType: 'application/vnd.choreon.voxel-material+json',
        ...(textureAssetId ? { baseColorTextureAssetId: textureAssetId } : {}),
      },
    });
    assetPayloadsRef.current.set(assetId, {
      assetId,
      mimeType: 'application/vnd.choreon.voxel-material+json',
      encoding: 'base64',
      data: encodeBase64(sourceBuffer),
    });
    setVoxelAssetMaterials((current) => [
      ...current,
      {
        assetId: record.id,
        name: record.name,
        color,
        roughness,
        ...(textureAssetId ? { textureAssetId } : {}),
      },
    ]);
    setVoxelMaterial('asset:' + assetId);
    setNewVoxelMaterialTexture(null);
    setIsDirty(true);
    pushDiagnostic({
      level: 'info',
      source: 'Voxel materials',
      message: 'Custom voxel material created',
      details:
        name +
        (textureAssetId
          ? ' is stored with a project texture asset and can be shared by chunks.'
          : ' is stored as a project asset and can be shared by chunks.'),
    });
  };

  const updateVoxelCell = (value: number, cell = voxelCell) => {
    if (!selectedVoxelChunk) return;
    const material = voxelMaterial.startsWith('asset:')
      ? { kind: 'asset' as const, assetId: voxelMaterial.slice('asset:'.length) }
      : {
          kind: 'builtin' as const,
          key: voxelMaterial.startsWith('builtin:')
            ? voxelMaterial.slice('builtin:'.length)
            : 'grass',
        };
    const existingIndex = selectedVoxelChunk.palette.findIndex(
      (entry) =>
        entry.material.kind === material.kind &&
        (entry.material.kind === 'asset'
          ? entry.material.assetId === (material.kind === 'asset' ? material.assetId : '')
          : entry.material.key === (material.kind === 'builtin' ? material.key : '')),
    );
    let base = selectedVoxelChunk;
    let paletteIndex = existingIndex + 1;
    if (value > 0 && existingIndex < 0) {
      const palette = [...selectedVoxelChunk.palette, { material }];
      base = createVoxelChunkSnapshot({
        coordinate: selectedVoxelChunk.coordinate,
        revision: selectedVoxelChunk.revision,
        palette,
        cells: selectedVoxelChunk.copyCells(),
      });
      paletteIndex = palette.length;
    }
    const result = editVoxelChunk(base, [{ ...cell, value: value === 0 ? 0 : paletteIndex }]);
    if (result.snapshot === selectedVoxelChunk) return;
    const chunkKey =
      selectedVoxelChunk.coordinate.x +
      ',' +
      selectedVoxelChunk.coordinate.y +
      ',' +
      selectedVoxelChunk.coordinate.z;
    commitVoxelChunks(
      voxelChunksRef.current.map((chunk) =>
        chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z === chunkKey
          ? result.snapshot
          : chunk,
      ),
    );
    setIsDirty(true);
    pushDiagnostic({
      level: 'info',
      source: 'Voxel editor',
      message: value === 0 ? 'Voxel cell cleared' : 'Voxel cell painted',
      details:
        'Chunk ' +
        chunkKey +
        ', cell (' +
        cell.x +
        ', ' +
        cell.y +
        ', ' +
        cell.z +
        '), revision ' +
        result.snapshot.revision +
        '.',
    });
  };

  const moveSelectedVoxelChunk = (target = voxelChunkTarget) => {
    if (!selectedVoxelChunk) return;
    const { x, y, z } = target;
    setVoxelChunkTarget({ x, y, z });
    if (![x, y, z].every(Number.isSafeInteger)) return;
    const nextKey = x + ',' + y + ',' + z;
    const currentKey =
      selectedVoxelChunk.coordinate.x +
      ',' +
      selectedVoxelChunk.coordinate.y +
      ',' +
      selectedVoxelChunk.coordinate.z;
    if (nextKey === currentKey) return;
    if (
      voxelChunks.some(
        (chunk) =>
          chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z === nextKey,
      )
    ) {
      pushDiagnostic({
        level: 'warning',
        source: 'Voxel editor',
        message: 'Cannot move chunk to an occupied coordinate',
        details: 'Chunk ' + nextKey + ' already exists.',
      });
      return;
    }
    if (selectedVoxelChunk.revision === Number.MAX_SAFE_INTEGER) return;
    const snapshot = createVoxelChunkSnapshot({
      coordinate: createChunkCoordinate({ x, y, z }),
      revision: selectedVoxelChunk.revision + 1,
      palette: selectedVoxelChunk.palette,
      cells: selectedVoxelChunk.copyCells(),
    });
    commitVoxelChunks(
      voxelChunksRef.current.map((chunk) =>
        chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z === currentKey
          ? snapshot
          : chunk,
      ),
    );
    setSelectedVoxelChunkKey(nextKey);
    setIsDirty(true);
    pushDiagnostic({
      level: 'info',
      source: 'Voxel editor',
      message: 'Voxel chunk moved',
      details: currentKey + ' → ' + nextKey + ', revision ' + snapshot.revision + '.',
    });
  };

  const removeSelectedVoxelChunk = () => {
    if (!selectedVoxelChunk) return;
    const chunkKey =
      selectedVoxelChunk.coordinate.x +
      ',' +
      selectedVoxelChunk.coordinate.y +
      ',' +
      selectedVoxelChunk.coordinate.z;
    commitVoxelChunks(
      voxelChunksRef.current.filter(
        (chunk) =>
          chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z !== chunkKey,
      ),
    );
    setSelectedVoxelChunkKey(null);
    setIsDirty(true);
  };

  const updateVector = (key: 'position' | 'rotation' | 'scale', axis: number, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number) || !selected) return;
    commitEntities(
      entities.map((entity) => {
        if (entity.id !== selectedId) return entity;
        if (key === 'rotation') {
          const euler = [...(entity.rotationEuler ?? [0, 0, 0])] as [number, number, number];
          euler[axis] = number;
          const half = euler.map((angle) => (angle * Math.PI) / 360);
          const [sx, sy, sz] = half.map(Math.sin);
          const [cx, cy, cz] = half.map(Math.cos);
          const rotation = [
            sx! * cy! * cz! - cx! * sy! * sz!,
            cx! * sy! * cz! + sx! * cy! * sz!,
            cx! * cy! * sz! - sx! * sy! * cz!,
            cx! * cy! * cz! + sx! * sy! * sz!,
          ] as const;
          return { ...entity, rotation, rotationEuler: euler };
        }
        const next = [...entity[key]] as [number, number, number];
        next[axis] = number;
        return { ...entity, [key]: next };
      }),
    );
  };

  const nudgeSelected = (direction: -1 | 1) => {
    if (!selected && selectedVoxelChunk) {
      if (transformMode !== 'position') return;
      const axis = (['x', 'y', 'z'] as const)[transformAxis]!;
      moveSelectedVoxelChunk({
        ...selectedVoxelChunk.coordinate,
        [axis]: selectedVoxelChunk.coordinate[axis] + direction,
      });
      return;
    }
    if (!selected) return;
    const current =
      transformMode === 'rotation'
        ? (selected.rotationEuler ?? [0, 0, 0])[transformAxis]!
        : selected[transformMode][transformAxis]!;
    const step = transformMode === 'rotation' ? 15 : 0.1;
    const next = current + direction * step;
    updateVector(
      transformMode,
      transformAxis,
      String(transformMode === 'scale' ? Math.max(0.05, next) : next),
    );
  };

  const renameSelected = (name: string) => {
    if (!selected || !name.trim()) return;
    commitEntities(
      entities.map((entity) =>
        entity.id === selectedId ? { ...entity, name: name.trim() } : entity,
      ),
    );
  };

  const createWorldDocument = (): WorldDocument => {
    const worldDocument: WorldDocument = {
      format: 'universal-3d-world',
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      engineVersion: '0.1.0',
      world: {
        id: 'world:editor-session',
        name: worldName,
        settings: { gravity: [0, -9.81, 0], environment: {} },
        entities: entities.map(
          ({ id, name, primitive, assetId, position, rotation, scale, material, geometry }) => ({
            id,
            name,
            parent: null,
            components: {
              Transform: { position, rotation, scale },
              MeshRenderer: {
                primitive,
                material: {
                  color: material.color,
                  roughness: material.roughness,
                  metalness: material.metalness,
                  opacity: material.opacity,
                  transparent: material.transparent,
                  wireframe: material.wireframe,
                  emissiveColor: material.emissiveColor ?? 0,
                  alphaMode: material.alphaMode ?? (material.transparent ? 'BLEND' : 'OPAQUE'),
                  alphaCutoff: material.alphaCutoff ?? 0.5,
                  doubleSided: material.doubleSided ?? false,
                  normalScale: material.normalScale ?? [1, 1],
                  occlusionStrength: material.occlusionStrength ?? 1,
                  ...(material.baseColorTexture
                    ? {
                        baseColorTextureAssetId: material.baseColorTexture.assetId,
                        baseColorTextureSettings: {
                          ...(material.baseColorTexture.sampler
                            ? { sampler: material.baseColorTexture.sampler }
                            : {}),
                          ...(material.baseColorTexture.transform
                            ? { transform: material.baseColorTexture.transform }
                            : {}),
                        },
                      }
                    : {}),
                  ...(material.metallicRoughnessTexture
                    ? {
                        metallicRoughnessTextureAssetId: material.metallicRoughnessTexture.assetId,
                        metallicRoughnessTextureSettings: {
                          ...(material.metallicRoughnessTexture.sampler
                            ? {
                                sampler: material.metallicRoughnessTexture.sampler,
                              }
                            : {}),
                          ...(material.metallicRoughnessTexture.transform
                            ? {
                                transform: material.metallicRoughnessTexture.transform,
                              }
                            : {}),
                        },
                      }
                    : {}),
                  ...(material.normalTexture
                    ? {
                        normalTextureAssetId: material.normalTexture.assetId,
                        normalTextureSettings: {
                          ...(material.normalTexture.sampler
                            ? { sampler: material.normalTexture.sampler }
                            : {}),
                          ...(material.normalTexture.transform
                            ? { transform: material.normalTexture.transform }
                            : {}),
                        },
                      }
                    : {}),
                  ...(material.occlusionTexture
                    ? {
                        occlusionTextureAssetId: material.occlusionTexture.assetId,
                        occlusionTextureSettings: {
                          ...(material.occlusionTexture.sampler
                            ? { sampler: material.occlusionTexture.sampler }
                            : {}),
                          ...(material.occlusionTexture.transform
                            ? { transform: material.occlusionTexture.transform }
                            : {}),
                        },
                      }
                    : {}),
                  ...(material.emissiveTexture
                    ? {
                        emissiveTextureAssetId: material.emissiveTexture.assetId,
                        emissiveTextureSettings: {
                          ...(material.emissiveTexture.sampler
                            ? { sampler: material.emissiveTexture.sampler }
                            : {}),
                          ...(material.emissiveTexture.transform
                            ? { transform: material.emissiveTexture.transform }
                            : {}),
                        },
                      }
                    : {}),
                },
                ...(assetId ? { assetId } : {}),
                ...(primitive === 'GLB'
                  ? {
                      geometry: {
                        positions: Array.from(geometry.positions),
                        normals: Array.from(geometry.normals),
                        indices: Array.from(geometry.indices),
                        ...(geometry.uvs ? { uvs: Array.from(geometry.uvs) } : {}),
                      },
                    }
                  : {}),
              },
            },
          }),
        ),
      },
      assets: assetRegistryRef.current.list(),
      assetPayloads: [...assetPayloadsRef.current.values()],
      extensions: {},
    };
    return worldDocument;
  };

  const saveWorld = () => {
    if (voxelChunks.length > 0) {
      pushDiagnostic({
        level: 'warning',
        source: 'Voxel',
        message: 'Save the project folder to preserve voxel chunks',
        details: 'A standalone .world file does not contain content-addressed voxel chunk blobs.',
      });
      return;
    }
    const worldDocument = createWorldDocument();
    const blob = new Blob([serializeWorld(worldDocument)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'world'}.world`;
    anchor.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
    setHasSaved(true);
  };

  const loadWorld = async (
    source?: File | WorldDocument,
    options: {
      readonly replaceAssets?: boolean;
      readonly voxelWorld?: {
        readonly settings: VoxelWorldSettings;
        readonly chunks: readonly VoxelChunkSnapshot[];
      };
    } = {},
  ): Promise<boolean> => {
    if (!source) return false;
    const sourceName = source instanceof File ? source.name : 'main.world';
    try {
      const root = source instanceof File ? parseWorld(await source.text()) : source;
      if (root.extensions[VOXEL_WORLD_EXTENSION_KEY] && !options.voxelWorld) {
        throw new Error(
          'This world contains external voxel chunk blobs. Open the project folder instead.',
        );
      }
      const restoredAssetRegistry = mergeAssetRegistry(
        options.replaceAssets ? new AssetRegistry() : assetRegistryRef.current,
        root.assets,
      );
      const restoredAssetPayloads = new Map(options.replaceAssets ? [] : assetPayloadsRef.current);
      for (const payload of root.assetPayloads ?? []) {
        const assetId = payload.assetId as AssetId;
        if (!restoredAssetRegistry.has(assetId)) {
          throw new Error(`Embedded payload references an unknown asset: ${payload.assetId}`);
        }
        const actualHash = await sha256(decodeBase64(payload.data));
        if (restoredAssetRegistry.require(assetId).contentHash !== actualHash) {
          throw new Error(`Embedded asset payload hash mismatch: ${payload.assetId}`);
        }
        const existingPayload = restoredAssetPayloads.get(assetId);
        if (existingPayload && existingPayload.data !== payload.data) {
          throw new Error(
            `Embedded asset payload conflicts with the current project: ${payload.assetId}`,
          );
        }
        restoredAssetPayloads.set(assetId, payload);
      }
      const parsed: SceneEntity[] = root.world.entities.map((entry, index) => {
        if (!entry || typeof entry !== 'object')
          throw new Error(`Invalid entity at index ${index}`);
        const entity = entry as {
          id?: string;
          name?: string;
          components?: {
            Transform?: {
              position?: number[];
              rotation?: number[];
              scale?: number[];
            };
            MeshRenderer?: {
              primitive?: Primitive | 'GLB';
              assetId?: string;
              material?: SceneEntity['material'] &
                Record<string, unknown> & {
                  readonly baseColorTextureAssetId?: string;
                };
              geometry?: {
                positions?: number[];
                normals?: number[];
                indices?: number[];
                uvs?: number[];
              };
            };
          };
        };
        const transform = entity.components?.Transform;
        const mesh = entity.components?.MeshRenderer;
        const primitive = mesh?.primitive;
        let geometry: MeshData;
        if (primitive === 'GLB') {
          const source = mesh?.geometry;
          if (
            !source ||
            !Array.isArray(source.positions) ||
            !Array.isArray(source.normals) ||
            !Array.isArray(source.indices) ||
            (source.uvs !== undefined && !Array.isArray(source.uvs)) ||
            ![...source.positions, ...source.normals, ...(source.uvs ?? [])].every(
              Number.isFinite,
            ) ||
            !source.indices.every((index) => Number.isInteger(index) && index >= 0)
          )
            throw new Error(`Entity ${entity.name} has invalid imported mesh buffers`);
          geometry = {
            positions: Float32Array.from(source.positions),
            normals: Float32Array.from(source.normals),
            indices: Uint32Array.from(source.indices),
            ...(source.uvs ? { uvs: Float32Array.from(source.uvs) } : {}),
          };
          validateMeshData(geometry);
        } else if (primitive && primitive in geometryFor) {
          geometry = geometryFor[primitive]();
        } else {
          throw new Error(`Entity ${index} has an unsupported geometry type`);
        }
        if (!entity.id || !entity.name || !transform || !mesh || !primitive)
          throw new Error(`Entity ${index} is missing supported Transform or MeshRenderer data`);
        if (mesh.assetId && !restoredAssetRegistry.has(mesh.assetId as AssetId))
          throw new Error(`Entity ${entity.name} references an unknown asset: ${mesh.assetId}`);
        const vector = (value: number[] | undefined, length: number, fallback: number[]) => {
          if (!value) return fallback;
          if (value.length !== length || value.some((n) => !Number.isFinite(n)))
            throw new Error(`Entity ${entity.name} has invalid transform values`);
          return value;
        };
        const storedMaterialValue =
          mesh.material === undefined ? createDefaultMaterial() : mesh.material;
        const pbrMaterialState = readPbrMaterialState(
          storedMaterialValue,
          `$.world.entities[${index}].components.MeshRenderer.material`,
        );
        const storedMaterial = storedMaterialValue as SceneEntity['material'] & {
          readonly baseColorTextureAssetId?: string;
          readonly metallicRoughnessTextureAssetId?: string;
          readonly normalTextureAssetId?: string;
          readonly occlusionTextureAssetId?: string;
          readonly emissiveTextureAssetId?: string;
          readonly baseColorTextureSettings?: Pick<TextureSource, 'sampler' | 'transform'>;
          readonly metallicRoughnessTextureSettings?: Pick<TextureSource, 'sampler' | 'transform'>;
          readonly normalTextureSettings?: Pick<TextureSource, 'sampler' | 'transform'>;
          readonly occlusionTextureSettings?: Pick<TextureSource, 'sampler' | 'transform'>;
          readonly emissiveTextureSettings?: Pick<TextureSource, 'sampler' | 'transform'>;
        };
        const restoreTexture = (
          assetId: string | undefined,
          settings?: Pick<TextureSource, 'sampler' | 'transform'>,
        ) => {
          if (!assetId) return undefined;
          const textureRecord = restoredAssetRegistry.require(assetId as AssetId);
          if (textureRecord.kind !== 'texture')
            throw new Error(`Material reference is not a texture asset: ${assetId}`);
          const payload = restoredAssetPayloads.get(assetId as AssetId);
          if (!payload)
            throw new Error(`Material references a missing embedded texture payload: ${assetId}`);
          if (
            payload.mimeType !== 'image/png' &&
            payload.mimeType !== 'image/jpeg' &&
            payload.mimeType !== 'image/webp'
          )
            throw new Error(`Material references an unsupported texture payload: ${assetId}`);
          return {
            assetId,
            cacheKey: textureRecord.contentHash,
            mimeType: payload.mimeType,
            data: new Uint8Array(decodeBase64(payload.data)),
            ...(settings?.sampler ? { sampler: settings.sampler } : {}),
            ...(settings?.transform ? { transform: settings.transform } : {}),
          } as const;
        };
        const baseColorTexture = restoreTexture(
          storedMaterial.baseColorTextureAssetId,
          storedMaterial.baseColorTextureSettings,
        );
        const metallicRoughnessTexture = restoreTexture(
          storedMaterial.metallicRoughnessTextureAssetId,
          storedMaterial.metallicRoughnessTextureSettings,
        );
        const normalTexture = restoreTexture(
          storedMaterial.normalTextureAssetId,
          storedMaterial.normalTextureSettings,
        );
        const occlusionTexture = restoreTexture(
          storedMaterial.occlusionTextureAssetId,
          storedMaterial.occlusionTextureSettings,
        );
        const emissiveTexture = restoreTexture(
          storedMaterial.emissiveTextureAssetId,
          storedMaterial.emissiveTextureSettings,
        );
        const material = {
          color: storedMaterial.color,
          roughness: storedMaterial.roughness,
          metalness: storedMaterial.metalness,
          opacity: storedMaterial.opacity,
          wireframe: storedMaterial.wireframe,
          emissiveColor: storedMaterial.emissiveColor ?? 0,
          ...pbrMaterialState,
          ...(baseColorTexture ? { baseColorTexture } : {}),
          ...(metallicRoughnessTexture ? { metallicRoughnessTexture } : {}),
          ...(normalTexture ? { normalTexture } : {}),
          ...(occlusionTexture ? { occlusionTexture } : {}),
          ...(emissiveTexture ? { emissiveTexture } : {}),
        };
        return {
          id: entity.id,
          name: entity.name,
          primitive,
          ...(mesh.assetId ? { assetId: mesh.assetId as AssetId } : {}),
          geometry,
          material,
          position: vector(transform.position, 3, [0, 0, 0]) as [number, number, number],
          rotation: vector(transform.rotation, 4, [0, 0, 0, 1]) as [number, number, number, number],
          scale: vector(transform.scale, 3, [1, 1, 1]) as [number, number, number],
        };
      });
      if (new Set(parsed.map((item) => item.id)).size !== parsed.length)
        throw new Error('World contains duplicate entity IDs');
      assetRegistryRef.current = restoredAssetRegistry;
      assetPayloadsRef.current = restoredAssetPayloads;
      setVoxelAssetMaterials(
        restoredAssetRegistry
          .list('material')
          .filter((record) => record.metadata.role === 'voxel-material')
          .map((record) => ({
            assetId: record.id,
            name: record.name,
            color: typeof record.metadata.color === 'number' ? record.metadata.color : 0x8995a5,
            roughness:
              typeof record.metadata.roughness === 'number' ? record.metadata.roughness : 0.9,
            ...(typeof record.metadata.baseColorTextureAssetId === 'string'
              ? { textureAssetId: record.metadata.baseColorTextureAssetId }
              : {}),
          })),
      );
      commitEntities(parsed);
      if (options.replaceAssets) {
        for (const lease of assetResourceLeasesRef.current) lease.release();
        assetResourceLeasesRef.current = [];
      }
      setSelectedId(parsed[0]?.id ?? '');
      setWorldName(root.world.name || sourceName.replace(/\.world$/i, ''));
      setVoxelWorldSettings(
        options.voxelWorld?.settings ?? {
          voxelSize: 1,
          chunkDimensions: { x: 16, y: 16, z: 16 },
        },
      );
      const restoredVoxelChunks = options.voxelWorld?.chunks ?? [];
      voxelChunksRef.current = restoredVoxelChunks;
      setVoxelChunks(restoredVoxelChunks);
      history.current.clear();
      setHistoryVersion((version) => version + 1);
      const firstRestoredChunk = restoredVoxelChunks[0];
      setSelectedVoxelChunkKey(
        firstRestoredChunk
          ? `${firstRestoredChunk.coordinate.x},${firstRestoredChunk.coordinate.y},${firstRestoredChunk.coordinate.z}`
          : null,
      );
      projectDirectoryRef.current = null;
      setIsDirty(false);
      setHasSaved(true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDiagnostic({
        level: 'error',
        source: 'World',
        message: `Could not open ${sourceName}`,
        details: message,
      });
      return false;
    }
  };

  const directoryPicker = () => (window as DirectoryPickerWindow).showDirectoryPicker;

  const saveProjectDirectory = async () => {
    try {
      const picker = directoryPicker();
      if (!projectDirectoryRef.current && !picker) {
        throw new Error(
          'Directory projects are not supported in this browser. Use Save World instead.',
        );
      }
      const directory = projectDirectoryRef.current ?? (await picker!({ mode: 'readwrite' }));
      projectDirectoryRef.current = directory;
      await saveVoxelWorldProject(
        new BrowserProjectFileStore(directory),
        createWorldDocument(),
        voxelWorldSettings,
        voxelChunks,
      );
      setIsDirty(false);
      setHasSaved(true);
      pushDiagnostic({
        level: 'info',
        source: 'Project',
        message: 'Project folder saved',
        details: `Binary assets and ${voxelChunks.length} voxel chunks were hash-verified before worlds/main.world.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      pushDiagnostic({
        level: 'error',
        source: 'Project',
        message: 'Could not save project folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const openProjectDirectory = async () => {
    try {
      const picker = directoryPicker();
      if (!picker)
        throw new Error(
          'Directory projects are not supported in this browser. Use Open World instead.',
        );
      const directory = await picker({ mode: 'readwrite' });
      const store = new BrowserProjectFileStore(directory);
      const document = await loadDirectoryProject(store);
      const voxelWorld = document.extensions[VOXEL_WORLD_EXTENSION_KEY]
        ? await loadVoxelWorldProject(store)
        : null;
      if (
        !(await loadWorld(document, {
          replaceAssets: true,
          ...(voxelWorld
            ? {
                voxelWorld: {
                  settings: voxelWorld.settings,
                  chunks: voxelWorld.chunks,
                },
              }
            : {}),
        }))
      )
        return;
      projectDirectoryRef.current = directory;
      pushDiagnostic({
        level: 'info',
        source: 'Project',
        message: 'Project folder opened',
        details: `External assets and ${voxelWorld?.chunks.length ?? 0} voxel chunks were hash-verified before the scene was committed.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      pushDiagnostic({
        level: 'error',
        source: 'Project',
        message: 'Could not open project folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const importGlb = async (file?: File) => {
    if (!file) return;
    const controller = new AbortController();
    activeGlbImportControllersRef.current.add(controller);
    const ensureImportActive = () => {
      if (controller.signal.aborted) throw new Error('GLB import was cancelled');
    };
    let pendingLease: AssetResourceLease<ImportedAsset<GlbAsset>> | null = null;
    try {
      const three = await import('three');
      ensureImportActive();
      const { Matrix4, Quaternion, Vector3 } = three;
      const importer = new WorkerGlbImporter();
      if (!glbImporterRegisteredRef.current) {
        assetImportServiceRef.current.register(importer);
        glbImporterRegisteredRef.current = true;
      }
      let sourceBytes = await file.arrayBuffer();
      ensureImportActive();
      const safeFileName = file.name.replace(/[\\/]/g, '_').replace(/^\.+/, '') || 'import.glb';
      const uri = `imports/${safeFileName}`;
      const contentHash = await sha256(sourceBytes);
      ensureImportActive();
      pendingLease = await assetResourceCacheRef.current.acquire(
        contentHash,
        (sharedSignal) =>
          assetImportServiceRef.current.import<GlbAsset>(uri, sourceBytes, {
            signal: sharedSignal,
            onSourceRestored: (restoredSource) => {
              sourceBytes = restoredSource;
            },
          }),
        () => {
          // CPU mesh buffers are garbage-collected after the final editor lease is released.
        },
        controller.signal,
      );
      ensureImportActive();
      const imported = pendingLease.resource;
      const asset = imported.data;
      const parentOf = new Map<number, number>();
      asset.nodes.forEach((node, parent) =>
        node.children.forEach((child) => {
          if (parentOf.has(child)) throw new Error(`GLB node ${child} has more than one parent`);
          parentOf.set(child, parent);
        }),
      );
      const sources: {
        name: string;
        primitive: (typeof asset.meshes)[number]['primitives'][number];
        position: readonly [number, number, number];
        rotation: readonly [number, number, number, number];
        scale: readonly [number, number, number];
        key: string;
      }[] = [];
      const visited = new Set<number>();
      const active = new Set<number>();
      const visitNode = (nodeIndex: number, parentWorld: Matrix4Type) => {
        if (active.has(nodeIndex))
          throw new Error(`GLB node hierarchy contains a cycle at node ${nodeIndex}`);
        if (visited.has(nodeIndex))
          throw new Error(`GLB node ${nodeIndex} is referenced more than once`);
        const node = asset.nodes[nodeIndex];
        if (!node) throw new Error(`GLB references missing node ${nodeIndex}`);
        active.add(nodeIndex);
        visited.add(nodeIndex);
        const local = new Matrix4().compose(
          new Vector3(...node.translation),
          new Quaternion(...node.rotation),
          new Vector3(...node.scale),
        );
        const world = parentWorld.clone().multiply(local);
        const position = new Vector3();
        const rotation = new Quaternion();
        const scale = new Vector3();
        world.decompose(position, rotation, scale);
        const reconstructed = new Matrix4().compose(position, rotation, scale);
        if (
          world.elements.some(
            (value, index) => Math.abs(value - reconstructed.elements[index]!) > 1e-4,
          )
        ) {
          throw new Error(
            `GLB node ${node.name} has a combined transform with shear; this cannot be represented by the Editor Transform yet`,
          );
        }
        if (node.mesh !== null) {
          const mesh = asset.meshes[node.mesh];
          if (!mesh) throw new Error(`GLB node ${nodeIndex} references missing mesh ${node.mesh}`);
          mesh.primitives.forEach((primitive, primitiveIndex) =>
            sources.push({
              name: node.name || mesh.name,
              primitive,
              position: [position.x, position.y, position.z],
              rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
              scale: [scale.x, scale.y, scale.z],
              key: `${nodeIndex}-${primitiveIndex}`,
            }),
          );
        }
        node.children.forEach((child) => visitNode(child, world));
        active.delete(nodeIndex);
      };
      const rootNodes = asset.nodes
        .map((_, index) => index)
        .filter((index) => !parentOf.has(index));
      rootNodes.forEach((root) => visitNode(root, new Matrix4()));
      if (visited.size !== asset.nodes.length)
        throw new Error('GLB node hierarchy contains a cycle or nodes without a root');
      if (!asset.nodes.length) {
        asset.meshes.forEach((mesh, meshIndex) =>
          mesh.primitives.forEach((primitive, primitiveIndex) =>
            sources.push({
              name: mesh.name,
              primitive,
              position: [0, 0, 0],
              rotation: [0, 0, 0, 1],
              scale: [1, 1, 1],
              key: `${meshIndex}-${primitiveIndex}`,
            }),
          ),
        );
      }
      if (!sources.length) throw new Error('The GLB contains no renderable triangle meshes');
      const importedEntitiesWithoutAsset: SceneEntity[] = sources.map((source, index) => {
        const pbr =
          source.primitive.material === null
            ? undefined
            : asset.materials[source.primitive.material];
        const factor = pbr?.baseColorFactor ?? [0.72, 0.76, 0.82, 1];
        const toSrgb = (value: number) => {
          const linear = Math.min(1, Math.max(0, value));
          return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
        };
        const color = factor
          .slice(0, 3)
          .reduce((hex, value) => (hex << 8) | Math.round(toSrgb(value!) * 255), 0);
        const alpha = Math.min(1, Math.max(0, factor[3] ?? 1));
        const emissiveColor = (pbr?.emissiveFactor ?? [0, 0, 0]).reduce(
          (hex, value) => (hex << 8) | Math.round(toSrgb(value) * 255),
          0,
        );
        return {
          id: `glb-${Date.now()}-${index}-${source.key}`,
          name: sources.length === 1 ? source.name : `${source.name} · ${index + 1}`,
          primitive: 'GLB',
          geometry: source.primitive.mesh,
          material: {
            color,
            roughness: pbr?.roughnessFactor ?? 1,
            metalness: pbr?.metallicFactor ?? 1,
            opacity: pbr?.alphaMode === 'BLEND' || pbr?.alphaMode === 'MASK' ? alpha : 1,
            transparent: pbr?.alphaMode === 'BLEND',
            wireframe: false,
            emissiveColor,
            alphaMode: pbr?.alphaMode ?? 'OPAQUE',
            alphaCutoff: pbr?.alphaCutoff ?? 0.5,
            doubleSided: pbr?.doubleSided ?? false,
            normalScale: [pbr?.normalScale ?? 1, pbr?.normalScale ?? 1],
            occlusionStrength: pbr?.occlusionStrength ?? 1,
          },
          position: source.position,
          rotation: source.rotation,
          scale: source.scale,
        };
      });
      // Stage embedded texture assets and the model record in a project-scoped copy.
      // This keeps registry/payload state unchanged if any image hash or registration fails.
      const stagedRegistry = mergeAssetRegistry(assetRegistryRef.current, []);
      const stagedPayloads = new Map(assetPayloadsRef.current);
      const textureRecords: AssetId[] = [];
      for (const [imageIndex, image] of asset.images.entries()) {
        // The importer already owns a tightly-sized image byte buffer.
        const imageBuffer = image.data.buffer as ArrayBuffer;
        const imageHash = await sha256(imageBuffer);
        ensureImportActive();
        const extension =
          image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const textureRecord = stagedRegistry.register({
          name: image.name,
          kind: 'texture',
          uri: `${uri}.image-${imageIndex}.${extension}`,
          contentHash: imageHash,
          importer: {
            id: 'engine.gltf.embedded-image',
            version: importer.version,
            settings: {},
          },
          dependencies: [],
          metadata: {
            sourceFormat: 'glb',
            imageIndex,
            mimeType: image.mimeType,
          },
        });
        textureRecords.push(textureRecord.id);
        stagedPayloads.set(textureRecord.id, {
          assetId: textureRecord.id,
          mimeType: image.mimeType,
          encoding: 'base64',
          data: encodeBase64(imageBuffer),
        });
      }
      const assetRecord = stagedRegistry.register({
        name: file.name || safeFileName,
        kind: imported.kind,
        uri,
        contentHash,
        importer: { id: importer.id, version: importer.version, settings: {} },
        dependencies: [...(imported.dependencies as AssetId[]), ...textureRecords],
        metadata: { ...imported.metadata, fileSize: file.size },
      });
      const resolveTextureSource = (
        textureIndex: number | undefined,
        channel: 'baseColor' | 'metallicRoughness' | 'normal' | 'occlusion' | 'emissive',
        transform?: {
          offset: readonly [number, number];
          rotation: number;
          scale: readonly [number, number];
        },
      ) => {
        if (textureIndex === undefined) return undefined;
        const texture = asset.textures[textureIndex];
        if (!texture || texture.source === null)
          throw new Error(`GLB material references an unavailable texture: ${textureIndex}`);
        const image = asset.images[texture.source];
        const textureAssetId = textureRecords[texture.source];
        if (!image || !textureAssetId)
          throw new Error(`GLB material references an unavailable image: ${textureIndex}`);
        return {
          assetId: textureAssetId,
          cacheKey: stagedRegistry.require(textureAssetId).contentHash,
          mimeType: image.mimeType,
          data: image.data,
          ...(texture.sampler === null ? {} : { sampler: asset.samplers[texture.sampler]! }),
          ...(transform ? { transform } : {}),
        } as const;
      };
      const importedEntities = importedEntitiesWithoutAsset.map((entity, entityIndex) => {
        const source = sources[entityIndex]!;
        const pbr =
          source.primitive.material === null
            ? undefined
            : asset.materials[source.primitive.material];
        const baseColorTexture = resolveTextureSource(
          pbr?.baseColorTexture,
          'baseColor',
          pbr?.textureTransforms?.baseColor,
        );
        const metallicRoughnessTexture = resolveTextureSource(
          pbr?.metallicRoughnessTexture,
          'metallicRoughness',
          pbr?.textureTransforms?.metallicRoughness,
        );
        const normalTexture = resolveTextureSource(
          pbr?.normalTexture,
          'normal',
          pbr?.textureTransforms?.normal,
        );
        const occlusionTexture = resolveTextureSource(
          pbr?.occlusionTexture,
          'occlusion',
          pbr?.textureTransforms?.occlusion,
        );
        const emissiveTexture = resolveTextureSource(
          pbr?.emissiveTexture,
          'emissive',
          pbr?.textureTransforms?.emissive,
        );
        return {
          ...entity,
          assetId: assetRecord.id,
          material: {
            ...entity.material,
            ...(baseColorTexture ? { baseColorTexture } : {}),
            ...(metallicRoughnessTexture ? { metallicRoughnessTexture } : {}),
            ...(normalTexture ? { normalTexture } : {}),
            ...(occlusionTexture ? { occlusionTexture } : {}),
            ...(emissiveTexture ? { emissiveTexture } : {}),
          },
        };
      });
      stagedPayloads.set(assetRecord.id, {
        assetId: assetRecord.id,
        mimeType: 'model/gltf-binary',
        encoding: 'base64',
        data: encodeBase64(sourceBytes),
      });
      ensureImportActive();
      assetRegistryRef.current = stagedRegistry;
      assetPayloadsRef.current = stagedPayloads;
      assetResourceLeasesRef.current.push(pendingLease);
      pendingLease = null;
      commitEntities([...entitiesRef.current, ...importedEntities]);
      setSelectedId(importedEntities[0]!.id);
      pushDiagnostic({
        level: 'info',
        source: 'GLB Importer',
        message: `Imported ${file.name}`,
        details: `${importedEntities.length} scene object(s) created`,
      });
    } catch (error) {
      pendingLease?.release();
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        pushDiagnostic({
          level: 'error',
          source: 'GLB Importer',
          message: 'Importer engine.gltf.glb failed',
          details: `${file.name}\n${message}`,
        });
      }
    } finally {
      activeGlbImportControllersRef.current.release(controller);
    }
  };

  const resetCamera = () => setCamera(createDefaultCamera());

  const removeSelected = () => {
    if (!selected) return;
    const next = entities.filter((entity) => entity.id !== selectedId);
    commitEntities(next);
    setSelectedId(next[0]?.id ?? '');
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const pointers = activePointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.size >= 2) {
      multiTouchRef.current = true;
      dragRef.current = null;
      const [first, second] = [...pointers.values()];
      pinchDistanceRef.current = Math.hypot(first!.x - second!.x, first!.y - second!.y);
      return;
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (cameraTool === 'select' && !event.buttons) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const surface = rendererRef.current?.pickSurface(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        bounds.width,
        bounds.height,
      );
      const match = surface?.entityId.startsWith('voxel:')
        ? /^voxel:(-?\d+),(-?\d+),(-?\d+):/.exec(surface.entityId)
        : null;
      const chunkKey = match ? [match[1], match[2], match[3]].join(',') : null;
      const chunk = chunkKey
        ? voxelChunks.find(
            (candidate) =>
              [candidate.coordinate.x, candidate.coordinate.y, candidate.coordinate.z].join(',') ===
              chunkKey,
          )
        : null;
      const cell =
        surface && chunk
          ? resolveVoxelBrushCell(surface, chunk, voxelWorldSettings, voxelBrushMode)
          : null;
      setBrushPreview(cell && chunkKey ? { chunkKey, cell, mode: voxelBrushMode } : null);
    } else if (cameraTool !== 'select') {
      setBrushPreview(null);
    }
    const pointers = activePointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
      const previousDistance = pinchDistanceRef.current;
      pinchDistanceRef.current = distance;
      if (previousDistance && distance > 0) {
        const factor = previousDistance / distance;
        setCamera((current) => {
          const [x, y, z] = current.position;
          const currentRadius = Math.hypot(x, y, z);
          const radius = Math.min(40, Math.max(1.5, currentRadius * factor));
          const scale = radius / currentRadius;
          const position: Vec3 = [x * scale, y * scale, z * scale];
          return {
            ...current,
            position,
            rotation: lookAtQuaternion(position, [0, 0, 0]),
          };
        });
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (cameraTool === 'select') return;
    if (cameraTool === 'pan') {
      setCamera((current) => {
        const [x, y, z] = current.position;
        const forward: Vec3 = [-Math.sin(Math.atan2(x, z)), 0, -Math.cos(Math.atan2(x, z))];
        const right: Vec3 = [forward[2], 0, -forward[0]];
        const speed = Math.max(0.004, Math.hypot(x, y, z) * 0.0018);
        const position: Vec3 = [
          x + right[0] * dx * speed + forward[0] * dy * speed,
          y,
          z + right[2] * dx * speed + forward[2] * dy * speed,
        ];
        return { ...current, position };
      });
      return;
    }
    setCamera((current) => {
      const [x, y, z] = current.position;
      const radius = Math.max(1.5, Math.hypot(x, y, z));
      const theta = Math.atan2(x, z) - dx * 0.008;
      let phi = Math.acos(Math.min(0.98, Math.max(-0.98, y / radius))) - dy * 0.008;
      phi = Math.min(Math.PI - 0.08, Math.max(0.08, phi));
      const position: Vec3 = [
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta),
      ];
      return {
        ...current,
        position,
        rotation: lookAtQuaternion(position, [0, 0, 0]),
      };
    });
  };
  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setCamera((current) => {
      const [x, y, z] = current.position;
      const factor = Math.exp(event.deltaY * 0.001);
      const radius = Math.min(40, Math.max(1.5, Math.hypot(x, y, z) * factor));
      const scale = radius / Math.hypot(x, y, z);
      const position: Vec3 = [x * scale, y * scale, z * scale];
      return {
        ...current,
        position,
        rotation: lookAtQuaternion(position, [0, 0, 0]),
      };
    });
  };

  useEffect(() => {
    let active = true;
    const store = new EditorRecoveryStore();
    recoveryStoreRef.current = store;
    void (async () => {
      try {
        const document = await loadStoredDirectoryProject(store);
        const voxelWorld = document.extensions[VOXEL_WORLD_EXTENSION_KEY]
          ? await loadVoxelWorldProject(store)
          : null;
        if (!active) return;
        await loadWorld(document, {
          replaceAssets: true,
          ...(voxelWorld
            ? { voxelWorld: { settings: voxelWorld.settings, chunks: voxelWorld.chunks } }
            : {}),
        });
        if (active) {
          setRecoveryStatus('saved');
          pushDiagnostic({
            level: 'info',
            source: 'Recovery',
            message: 'Recovered the latest local draft',
            details: 'The draft was restored from this browser.',
          });
        }
      } catch (error) {
        if (
          active &&
          error instanceof Error &&
          !error.message.startsWith('Recovery file not found:')
        ) {
          setRecoveryStatus('error');
          pushDiagnostic({
            level: 'warning',
            source: 'Recovery',
            message: 'Could not restore the local draft',
            details: error.message,
          });
        }
      } finally {
        if (active) setRecoveryReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!recoveryReady || !isDirty) return;
    const store = recoveryStoreRef.current;
    if (!store) return;
    setRecoveryStatus('saving');
    const timeout = window.setTimeout(() => {
      void saveVoxelWorldProject(store, createWorldDocument(), voxelWorldSettings, voxelChunks)
        .then(() => setRecoveryStatus('saved'))
        .catch((error: unknown) => {
          setRecoveryStatus('error');
          pushDiagnostic({
            level: 'warning',
            source: 'Recovery',
            message: 'Local autosave failed',
            details: error instanceof Error ? error.message : String(error),
          });
        });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [
    recoveryReady,
    isDirty,
    entities,
    worldName,
    voxelWorldSettings,
    voxelChunks,
    voxelAssetMaterials,
  ]);

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div className="brand-mark">◇</div>
        <strong>CHOREON</strong>
        <details className="file-menu" style={{ position: 'relative' }}>
          <summary className="toolbar-button" style={{ cursor: 'pointer', listStyle: 'none' }}>
            File ▾
          </summary>
          <div
            className="file-menu-content"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 20,
              minWidth: 180,
              padding: 6,
              border: '1px solid var(--panel-border, #354052)',
              borderRadius: 8,
              background: 'var(--panel-bg, #202936)',
              boxShadow: '0 8px 24px rgba(0,0,0,.3)',
            }}
          >
            <button
              className="toolbar-button"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => glbInputRef.current?.click()}
            >
              Import GLB…
            </button>
            <button
              className="toolbar-button"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => fileInputRef.current?.click()}
            >
              Open World…
            </button>
            <button
              className="toolbar-button"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={saveWorld}
            >
              Save World…
            </button>
            {directoryPicker() ? (
              <>
                <button
                  className="toolbar-button"
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => void openProjectDirectory()}
                >
                  Open Project Folder…
                </button>
                <button
                  className="toolbar-button"
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => void saveProjectDirectory()}
                >
                  Save Project Folder…
                </button>
              </>
            ) : null}
          </div>
        </details>
        <input
          className="world-name"
          aria-label="World name"
          value={worldName}
          onChange={(event) => {
            setWorldName(event.target.value);
            setIsDirty(true);
          }}
        />
        <span className="autosave-status" role="status" aria-live="polite">
          {recoveryStatus === 'saving'
            ? 'Saving…'
            : recoveryStatus === 'saved'
              ? 'Saved locally'
              : recoveryStatus === 'error'
                ? 'Autosave error'
                : ' '}
        </span>
        <button
          className="toolbar-button"
          onClick={undo}
          disabled={!history.current.canUndo}
          title="Undo (Ctrl/Cmd+Z)"
        >
          Undo
        </button>
        <button
          className="toolbar-button"
          onClick={redo}
          disabled={!history.current.canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          Redo
        </button>
        <input
          ref={glbInputRef}
          hidden
          type="file"
          accept=".glb,model/gltf-binary"
          onChange={(event) => {
            void importGlb(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".world,application/json"
          onChange={(event) => {
            void loadWorld(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <button
          className="toolbar-button diagnostics-trigger"
          onClick={() => setIsDiagnosticsOpen((open) => !open)}
          aria-expanded={isDiagnosticsOpen}
        >
          Console{' '}
          {diagnostics.filter((entry) => entry.level === 'error').length
            ? `· ${diagnostics.filter((entry) => entry.level === 'error').length}`
            : ''}
        </button>
        <span className="spacer" />
        <span className="status">
          <i className={`renderer-dot renderer-${rendererStatus}`} />
          {rendererStatus === 'ready'
            ? 'RENDERER ONLINE'
            : rendererStatus === 'error'
              ? 'RENDERER ERROR'
              : 'RENDERER LOADING'}
        </span>
      </header>
      <div className="workspace">
        <aside className="panel hierarchy">
          <div className="panel-heading">
            HIERARCHY{' '}
            <button
              aria-label="Add object"
              aria-expanded={isAddMenuOpen}
              aria-controls="hierarchy-add-menu"
              onClick={() => setIsAddMenuOpen((open) => !open)}
            >
              ＋
            </button>
          </div>
          {isAddMenuOpen ? (
            <div className="hierarchy-add-menu" id="hierarchy-add-menu" aria-label="Add object">
              {(['Box', 'Sphere', 'Plane', 'Cylinder'] as const).map((primitive) => (
                <button
                  key={primitive}
                  onClick={() => {
                    addEntity(primitive);
                    setIsAddMenuOpen(false);
                  }}
                >
                  <span>{primitive}</span>
                  <small>3D primitive</small>
                </button>
              ))}
              <button onClick={addVoxelChunk} aria-label="Add Voxel chunk">
                <span>Voxel chunk</span>
                <small>Empty · 16×16×16 editable grid</small>
              </button>
            </div>
          ) : null}
          <div className="tree-row active">
            ▣ <span>{worldName || 'Untitled World'}</span>
          </div>
          {entities.map((entity) => (
            <button
              key={entity.id}
              className={`tree-row entity-row ${entity.id === selectedId ? 'selected' : ''}`}
              onClick={() => {
                setSelectedVoxelChunkKey(null);
                setSelectedId(entity.id);
              }}
            >
              ◈ <span>{entity.name}</span>
            </button>
          ))}
          {voxelChunks.map((chunk) => {
            const key = chunk.coordinate.x + ',' + chunk.coordinate.y + ',' + chunk.coordinate.z;
            return (
              <button
                key={key}
                className={
                  'tree-row entity-row ' + (key === selectedVoxelChunkKey ? 'selected' : '')
                }
                onClick={() => {
                  setSelectedVoxelChunkKey(key);
                  setSelectedId('');
                }}
              >
                ▦ <span>Voxel chunk ({key})</span>
              </button>
            );
          })}
          <div className="panel-foot">
            <span>{entities.length} OBJECTS</span>
            <span>{voxelChunks.length} VOXEL CHUNKS</span>
          </div>
        </aside>
        <aside className="scene-tools" aria-label="Scene tools">
          <div className="scene-tools-heading">TOOLS</div>
          <div className="scene-tool-group" aria-label="Camera controls">
            <span className="scene-tool-label">CAMERA</span>
            <button
              className={cameraTool === 'pan' ? 'scene-tool active' : 'scene-tool'}
              aria-label="Move camera"
              aria-pressed={cameraTool === 'pan'}
              title="Move camera: drag left/right to strafe, up/down to move forward/back"
              onClick={() => {
                setCameraTool((current) => (current === 'pan' ? 'select' : 'pan'));
                setBrushPreview(null);
              }}
            >
              <span aria-hidden="true">✥</span>
              <small>Move</small>
            </button>
            <button
              className={cameraTool === 'rotate' ? 'scene-tool active' : 'scene-tool'}
              aria-label="Rotate camera"
              aria-pressed={cameraTool === 'rotate'}
              title="Rotate camera by dragging on the scene"
              onClick={() =>
                setCameraTool((current) => (current === 'rotate' ? 'select' : 'rotate'))
              }
            >
              <span aria-hidden="true">⟳</span>
              <small>Rotate</small>
            </button>
          </div>
          <div className="scene-tool-group" aria-label="Voxel tools">
            <span className="scene-tool-label">VOXELS</span>
            <button
              className={voxelBrushMode === 'paint' ? 'scene-tool active' : 'scene-tool'}
              aria-label="Paint voxels"
              aria-pressed={voxelBrushMode === 'paint'}
              onClick={() => {
                setVoxelBrushMode('paint');
                setCameraTool('select');
              }}
            >
              <span aria-hidden="true">▦</span>
              <small>Paint</small>
            </button>
            <button
              className={voxelBrushMode === 'erase' ? 'scene-tool active' : 'scene-tool'}
              aria-label="Erase voxels"
              aria-pressed={voxelBrushMode === 'erase'}
              onClick={() => {
                setVoxelBrushMode('erase');
                setCameraTool('select');
              }}
            >
              <span aria-hidden="true">⌫</span>
              <small>Erase</small>
            </button>
          </div>
        </aside>
        <section className="viewport">
          <div className="viewport-label">
            SCENE VIEW{' '}
            <span>{rendererStatus === 'ready' ? 'WEBGL2' : rendererStatus.toUpperCase()}</span>
            <button onClick={resetCamera}>Reset Camera</button>
          </div>
          <div
            className={`transform-pad ${isTransformPadCollapsed ? 'is-collapsed' : ''}`}
            aria-label="Transform controls"
          >
            <button
              className="transform-collapse-toggle"
              aria-label={
                isTransformPadCollapsed ? 'Expand transform panel' : 'Collapse transform panel'
              }
              aria-expanded={!isTransformPadCollapsed}
              onClick={() => setIsTransformPadCollapsed((collapsed) => !collapsed)}
            >
              {isTransformPadCollapsed ? '›' : '‹'}
            </button>
            {!isTransformPadCollapsed ? (
              <>
                <div className="transform-modes" role="group" aria-label="Transform mode">
                  {(
                    [
                      ['position', 'Move'],
                      ['rotation', 'Rotate'],
                      ['scale', 'Scale'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      aria-label={`${label} mode`}
                      aria-pressed={transformMode === mode}
                      className={transformMode === mode ? 'active' : ''}
                      disabled={!selected && (!selectedVoxelChunk || mode !== 'position')}
                      onClick={() => setTransformMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="transform-adjust" role="group" aria-label="Transform axis controls">
                  <span className="transform-axis-label">
                    {transformMode === 'position'
                      ? 'MOVE'
                      : transformMode === 'rotation'
                        ? 'ROT'
                        : 'SCALE'}
                  </span>
                  {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                    <button
                      key={axis}
                      aria-label={`${axis} axis`}
                      aria-pressed={transformAxis === index}
                      className={`axis-choice axis-${axis.toLowerCase()} ${transformAxis === index ? 'active' : ''}`}
                      disabled={!selected && !selectedVoxelChunk}
                      onClick={() => setTransformAxis(index)}
                    >
                      {axis}
                    </button>
                  ))}
                  <span className="transform-pad-spacer" />
                  <button
                    aria-label={`Decrease ${'XYZ'[transformAxis]}`}
                    disabled={!selected && !selectedVoxelChunk}
                    onClick={() => nudgeSelected(-1)}
                  >
                    −
                  </button>
                  <button
                    aria-label={`Increase ${'XYZ'[transformAxis]}`}
                    disabled={!selected && !selectedVoxelChunk}
                    onClick={() => nudgeSelected(1)}
                  >
                    ＋
                  </button>
                </div>
              </>
            ) : null}
          </div>
          <canvas
            ref={canvasRef}
            aria-label="3D scene viewport"
            data-camera-radius={Math.hypot(...camera.position).toFixed(3)}
            data-camera-tool={cameraTool}
            className={
              cameraTool === 'pan'
                ? 'camera-pan-active'
                : cameraTool === 'rotate'
                  ? 'camera-rotate-active'
                  : ''
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setBrushPreview(null)}
            onPointerUp={(event) => {
              const wasMultiTouch = multiTouchRef.current;
              activePointersRef.current.delete(event.pointerId);
              const drag = dragRef.current;
              dragRef.current = null;
              pinchDistanceRef.current = null;
              if (activePointersRef.current.size === 0) multiTouchRef.current = false;
              if (wasMultiTouch || !drag || drag.pointerId !== event.pointerId) return;
              if (cameraTool !== 'select') return;
              const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
              if (moved > 4) return;
              const canvas = event.currentTarget;
              const bounds = canvas.getBoundingClientRect();
              const localX = event.clientX - bounds.left;
              const localY = event.clientY - bounds.top;
              const renderer = rendererRef.current;
              const surface = renderer?.pickSurface(localX, localY, bounds.width, bounds.height);
              if (surface?.entityId.startsWith('voxel:')) {
                const match = /^voxel:(-?\d+),(-?\d+),(-?\d+):/.exec(surface.entityId);
                if (!match) return;
                const key = `${match[1]},${match[2]},${match[3]}`;
                if (
                  !selectedVoxelChunk ||
                  key !==
                    `${selectedVoxelChunk.coordinate.x},${selectedVoxelChunk.coordinate.y},${selectedVoxelChunk.coordinate.z}`
                ) {
                  setSelectedVoxelChunkKey(key);
                  setSelectedId('');
                  return;
                }
                const cell = resolveVoxelBrushCell(
                  surface,
                  selectedVoxelChunk,
                  voxelWorldSettings,
                  voxelBrushMode,
                );
                if (cell) {
                  setVoxelCell(cell);
                  updateVoxelCell(voxelBrushMode === 'paint' ? 1 : 0, cell);
                } else {
                  pushDiagnostic({
                    level: 'warning',
                    source: 'Voxel editor',
                    message: 'Brush target is outside the selected chunk',
                  });
                }
              } else if (surface) {
                setSelectedVoxelChunkKey(null);
                setSelectedId(surface.entityId);
              }
            }}
            onPointerCancel={(event) => {
              activePointersRef.current.delete(event.pointerId);
              dragRef.current = null;
              pinchDistanceRef.current = null;
              if (activePointersRef.current.size === 0) multiTouchRef.current = false;
            }}
            onWheel={onWheel}
          />
          <output ref={fpsRef} className="viewport-fps" aria-label="Frames per second">
            FPS --
          </output>
          {entities.length === 0 && voxelChunks.length === 0 ? (
            <div className="viewport-empty-state">
              <strong>Empty scene</strong>
              <span>Use + in Hierarchy to add a primitive, or File → Import GLB.</span>
            </div>
          ) : null}
          <div className="axis">
            X <b>Y</b> Z
          </div>
          <div className="viewport-help">
            Drag · Orbit <span>Pinch / Scroll · Zoom</span>
            {rendererError ? <span className="error-text">{rendererError}</span> : null}
          </div>
        </section>
        <aside className="panel inspector">
          <div className="panel-heading">
            INSPECTOR{' '}
            <button
              aria-label={
                selectedVoxelChunk ? 'Delete selected voxel chunk' : 'Delete selected object'
              }
              disabled={!selected && !selectedVoxelChunk}
              onClick={selectedVoxelChunk ? removeSelectedVoxelChunk : removeSelected}
            >
              ⌫
            </button>
          </div>
          {selectedVoxelChunk ? (
            <section className="voxel-inspector" aria-label="Voxel chunk editor">
              <div className="inspector-title">
                ▦ <strong>Voxel chunk</strong>
              </div>
              <div className="object-source">
                <span>
                  Chunk ({selectedVoxelChunk.coordinate.x}, {selectedVoxelChunk.coordinate.y},{' '}
                  {selectedVoxelChunk.coordinate.z})
                </span>
                <small>
                  Revision {selectedVoxelChunk.revision} · {selectedVoxelChunk.palette.length}{' '}
                  materials
                </small>
              </div>
              <label>CELL COORDINATES</label>
              <div className="vector-field">
                <span>XYZ</span>
                <div>
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <TransformNumberInput
                      key={axis}
                      label={'Voxel cell ' + axis.toUpperCase()}
                      value={voxelCell[axis]}
                      onCommit={(nextValue) => {
                        const next = Number(nextValue);
                        if (Number.isInteger(next) && next >= 0 && next < 16) {
                          setVoxelCell((current) => ({
                            ...current,
                            [axis]: next,
                          }));
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
              <label>WORLD VOXEL SIZE</label>
              <TransformNumberInput
                label="Voxel size in world units"
                value={voxelWorldSettings.voxelSize}
                onCommit={(raw) => {
                  const next = Number(raw);
                  if (!Number.isFinite(next) || next <= 0 || next > 1000) return;
                  setVoxelWorldSettings((current) => ({ ...current, voxelSize: next }));
                  setIsDirty(true);
                }}
              />
              <small>
                Each cell is this many world units. Chunk storage remains 16×16×16 cells.
              </small>
              <label>CHUNK COORDINATES</label>
              <div className="vector-field">
                <span>XYZ</span>
                <div>
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <TransformNumberInput
                      key={axis}
                      label={'Chunk ' + axis.toUpperCase()}
                      value={voxelChunkTarget[axis]}
                      onCommit={(nextValue) => {
                        const next = Number(nextValue);
                        if (Number.isSafeInteger(next)) {
                          setVoxelChunkTarget((current) => ({
                            ...current,
                            [axis]: next,
                          }));
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={() => moveSelectedVoxelChunk()}
                disabled={
                  voxelChunkTarget.x === selectedVoxelChunk.coordinate.x &&
                  voxelChunkTarget.y === selectedVoxelChunk.coordinate.y &&
                  voxelChunkTarget.z === selectedVoxelChunk.coordinate.z
                }
              >
                Move chunk
              </button>
              <small>
                Choose Paint or Erase in the Scene Tools panel, then click a visible voxel face
              </small>
              <label>WORLD MATERIAL LIBRARY</label>
              <div
                className="voxel-material-library"
                role="group"
                aria-label="World voxel materials"
              >
                {BUILTIN_VOXEL_MATERIALS.map((material) => {
                  const materialRef = 'builtin:' + material.key;
                  const selected = voxelMaterial === materialRef;
                  return (
                    <button
                      key={material.key}
                      type="button"
                      className={
                        selected ? 'voxel-material-swatch selected' : 'voxel-material-swatch'
                      }
                      aria-pressed={selected}
                      aria-label={'Select ' + material.label + ' voxel material'}
                      title={material.label}
                      onClick={() => setVoxelMaterial(materialRef)}
                    >
                      <span
                        className="voxel-material-color"
                        style={{
                          backgroundColor: '#' + material.color.toString(16).padStart(6, '0'),
                        }}
                      />
                      <span>{material.label}</span>
                    </button>
                  );
                })}
                {voxelAssetMaterials.map((material) => {
                  const materialRef = 'asset:' + material.assetId;
                  const selected = voxelMaterial === materialRef;
                  return (
                    <button
                      key={material.assetId}
                      type="button"
                      className={
                        selected ? 'voxel-material-swatch selected' : 'voxel-material-swatch'
                      }
                      aria-pressed={selected}
                      aria-label={'Select ' + material.name + ' voxel material'}
                      title={material.name}
                      onClick={() => setVoxelMaterial(materialRef)}
                    >
                      <span
                        className="voxel-material-color"
                        style={{
                          backgroundColor: '#' + material.color.toString(16).padStart(6, '0'),
                        }}
                      />
                      <span>{material.name}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="voxel-material-add"
                onClick={() => setIsVoxelMaterialDialogOpen(true)}
              >
                + Add material
              </button>
              <small>
                Built-ins and custom project materials share the world library. Optional PNG, JPEG
                or WebP textures are stored as dependent project assets and sampled on voxel faces.
              </small>
              <small>
                Choose a shared world material. A chunk adds its reference only after you paint with
                it.
              </small>
              <div className="voxel-edit-actions">
                <button
                  onClick={() => updateVoxelCell(1)}
                  disabled={
                    ![voxelCell.x, voxelCell.y, voxelCell.z].every(
                      (value) => Number.isInteger(value) && value >= 0 && value < 16,
                    )
                  }
                >
                  Paint cell
                </button>
                <button
                  onClick={() => updateVoxelCell(0)}
                  disabled={
                    ![voxelCell.x, voxelCell.y, voxelCell.z].every(
                      (value) => Number.isInteger(value) && value >= 0 && value < 16,
                    )
                  }
                >
                  Erase cell
                </button>
              </div>
              <label>PALETTE</label>
              <ul className="voxel-palette">
                {selectedVoxelChunk.palette.map((entry, index) => {
                  const isBuiltinMaterial = entry.material.kind === 'builtin';
                  const materialName = isBuiltinMaterial
                    ? entry.material.key
                    : entry.material.assetId;
                  const materialLabel = isBuiltinMaterial
                    ? (getBuiltinVoxelMaterial(entry.material.key)?.label ?? materialName)
                    : (voxelAssetMaterials.find((material) => material.assetId === materialName)
                        ?.name ?? materialName);
                  const usage = voxelPaletteUsage[index] ?? 0;
                  return (
                    <li
                      key={entry.material.kind + ':' + materialName}
                      className="voxel-palette-entry"
                    >
                      <span>{index + 1}</span>
                      <strong>{materialLabel}</strong>
                      <small>{usage} cells</small>
                      <button
                        aria-label={'Move ' + materialName + ' up'}
                        disabled={index === 0}
                        onClick={() => moveVoxelPaletteEntry(index, index - 1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={'Move ' + materialName + ' down'}
                        disabled={index === selectedVoxelChunk.palette.length - 1}
                        onClick={() => moveVoxelPaletteEntry(index, index + 1)}
                      >
                        ↓
                      </button>
                      <button
                        aria-label={'Remove ' + materialName}
                        disabled={usage > 0}
                        onClick={() => removeVoxelPaletteEntry(index)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button className="voxel-delete" onClick={removeSelectedVoxelChunk}>
                Delete voxel chunk
              </button>
            </section>
          ) : selected ? (
            <>
              <div className="inspector-title">
                ◈{' '}
                <input
                  aria-label="Object name"
                  value={selected.name}
                  onChange={(event) => renameSelected(event.target.value)}
                />
              </div>
              <label>TRANSFORM</label>
              {(['position', 'rotation', 'scale'] as const).map((key) => (
                <div className="vector-field" key={key}>
                  <span>{key[0]!.toUpperCase() + key.slice(1)}</span>
                  <div>
                    {(key === 'rotation'
                      ? (selected.rotationEuler ?? [0, 0, 0])
                      : selected[key]
                    ).map((value, axis) => (
                      <TransformNumberInput
                        key={axis}
                        label={`${key} ${'XYZ'[axis]}`}
                        value={value}
                        onCommit={(nextValue) => updateVector(key, axis, nextValue)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <label>OBJECT SOURCE</label>
              <div className="object-source">
                <span>
                  {selected.primitive === 'GLB'
                    ? 'Imported GLB mesh'
                    : `Built-in ${selected.primitive} primitive`}
                </span>
                {selected.assetId ? (
                  <code>{selected.assetId}</code>
                ) : (
                  <small>Generated geometry</small>
                )}
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              Select an object or voxel chunk in the Hierarchy, or add content to begin.
            </div>
          )}
        </aside>
      </div>
      {isDiagnosticsOpen ? (
        <section className="diagnostics-panel" aria-label="Technical console" aria-live="polite">
          <div className="diagnostics-heading">
            <strong>CONSOLE / DIAGNOSTICS</strong>
            <span>{diagnostics.length} EVENTS</span>
            <button onClick={() => setDiagnostics([])}>Clear</button>
            <button aria-label="Close console" onClick={() => setIsDiagnosticsOpen(false)}>
              ×
            </button>
          </div>
          <div className="diagnostics-list">
            {diagnostics.length ? (
              diagnostics.map((entry) => (
                <article className={`diagnostic-entry level-${entry.level}`} key={entry.id}>
                  <time>{entry.time}</time>
                  <b>{entry.level.toUpperCase()}</b>
                  <span className="diagnostic-source">{entry.source}</span>
                  <div>
                    <strong>{entry.message}</strong>
                    {entry.details ? <pre>{entry.details}</pre> : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="diagnostics-empty">
                No events yet. Import, load or edit a scene to see diagnostics.
              </div>
            )}
          </div>
        </section>
      ) : null}
      <footer className="bottombar">
        <span className={`renderer-state renderer-${rendererStatus}`}>
          ●{' '}
          {rendererStatus === 'ready'
            ? 'RENDERER ONLINE'
            : rendererStatus === 'error'
              ? 'RENDERER ERROR'
              : 'RENDERER LOADING'}
        </span>
        <span>
          {rendererStatus === 'ready'
            ? 'WebGL2 · Three.js adapter'
            : rendererStatus === 'error'
              ? 'Renderer unavailable'
              : 'Renderer initializing'}
        </span>
        <span className="spacer" />
        <span className={isDirty ? 'save-state is-dirty' : 'save-state'}>
          {isDirty
            ? recoveryStatus === 'saved'
              ? 'SAVED LOCALLY'
              : 'UNSAVED CHANGES'
            : hasSaved
              ? 'SAVED'
              : 'NEW SCENE'}
        </span>
        <span>{entities.length} objects</span>
      </footer>
      {isVoxelMaterialDialogOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsVoxelMaterialDialogOpen(false);
          }}
        >
          <section
            className="voxel-material-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="voxel-material-modal-title"
          >
            <div className="modal-heading">
              <h2 id="voxel-material-modal-title">Add world material</h2>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setIsVoxelMaterialDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="voxel-material-authoring">
              <label>
                Material name
                <input
                  aria-label="New voxel material name"
                  value={newVoxelMaterialName}
                  onChange={(event) => setNewVoxelMaterialName(event.target.value)}
                  placeholder="Material name"
                />
              </label>
              <label>
                Base color
                <input
                  aria-label="New voxel material color"
                  type="color"
                  value={newVoxelMaterialColor}
                  onChange={(event) => setNewVoxelMaterialColor(event.target.value)}
                />
              </label>
              <label>
                Roughness
                <input
                  aria-label="New voxel material roughness"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={newVoxelMaterialRoughness}
                  onChange={(event) => setNewVoxelMaterialRoughness(event.target.value)}
                />
              </label>
              <label>
                Optional texture
                <input
                  aria-label="New voxel material texture"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setNewVoxelMaterialTexture(event.target.files?.[0] ?? null)}
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setIsVoxelMaterialDialogOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void createVoxelMaterialAsset().then(() => setIsVoxelMaterialDialogOpen(false))
                  }
                  disabled={!newVoxelMaterialName.trim()}
                >
                  Create material
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
