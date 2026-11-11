import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssetImportService,
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
import { EditorHistory } from './EditorHistory.js';
import { parseWorld, serializeWorld, type WorldDocument } from '@engine/serialization';
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
import type { ThreeWebGLRendererAdapter } from '@engine/renderer';

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
const initialEntity = (): SceneEntity => ({
  id: 'entity-1',
  name: 'Box',
  primitive: 'Box',
  geometry: createBoxGeometry(),
  material: createDefaultMaterial(),
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

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
        if (existing.contentHash !== asset.contentHash || existing.uri !== asset.uri) {
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
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(source: string): ArrayBuffer {
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function EditorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ThreeWebGLRendererAdapter | null>(null);
  const [entities, setEntities] = useState<SceneEntity[]>([initialEntity()]);
  const entitiesRef = useRef(entities);
  const history = useRef(new EditorHistory<SceneEntity[]>(100));
  const [historyVersion, setHistoryVersion] = useState(0);
  void historyVersion;

  const commitEntities = (next: SceneEntity[]) => {
    history.current.commit(entitiesRef.current);
    entitiesRef.current = next;
    setEntities(next);
    setHistoryVersion((version) => version + 1);
  };

  const undo = useCallback(() => {
    const previous = history.current.undo(entitiesRef.current);
    if (!previous) return;
    entitiesRef.current = previous;
    setEntities(previous);
    setHistoryVersion((version) => version + 1);
    setSelectedId((current) =>
      previous.some((entity) => entity.id === current) ? current : (previous[0]?.id ?? ''),
    );
  }, []);

  const redo = useCallback(() => {
    const next = history.current.redo(entitiesRef.current);
    if (!next) return;
    entitiesRef.current = next;
    setEntities(next);
    setHistoryVersion((version) => version + 1);
    setSelectedId((current) =>
      next.some((entity) => entity.id === current) ? current : (next[0]?.id ?? ''),
    );
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
  const [selectedId, setSelectedId] = useState('entity-1');
  const [rendererError, setRendererError] = useState('');
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const pushDiagnostic = useCallback((entry: Omit<DiagnosticEntry, 'id' | 'time'>) => {
    setDiagnostics((current) =>
      [
        { ...entry, id: Date.now() + Math.random(), time: new Date().toLocaleTimeString() },
        ...current,
      ].slice(0, 200),
    );
  }, []);
  const [worldName, setWorldName] = useState('Untitled World');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const assetRegistryRef = useRef(new AssetRegistry());
  const assetImportServiceRef = useRef(new AssetImportService());
  const glbImporterRegisteredRef = useRef(false);
  const assetPayloadsRef = useRef(new Map<AssetId, WorldAssetPayload>());
  const assetResourceCacheRef = useRef(new AssetResourceCache<ImportedAsset<GlbAsset>>());
  const assetResourceLeasesRef = useRef<AssetResourceLease<ImportedAsset<GlbAsset>>[]>([]);
  useEffect(
    () => () => {
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

  const renderObjects = useMemo(
    () =>
      entities.map((entity) => ({
        ...entity,
        material:
          entity.id === selectedId
            ? { ...entity.material, color: entity.material.color }
            : entity.material,
      })),
    [entities, selectedId],
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
        };
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        canvas.dataset.rendererError = message;
        setRendererError(message);
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

  const saveWorld = () => {
    const worldDocument: WorldDocument = {
      format: 'universal-3d-world',
      schemaVersion: '1.0.0',
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
                            ? { sampler: material.metallicRoughnessTexture.sampler }
                            : {}),
                          ...(material.metallicRoughnessTexture.transform
                            ? { transform: material.metallicRoughnessTexture.transform }
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
    const blob = new Blob([serializeWorld(worldDocument)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'world'}.world`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadWorld = async (file?: File) => {
    if (!file) return;
    try {
      const root = parseWorld(await file.text());
      const restoredAssetRegistry = mergeAssetRegistry(assetRegistryRef.current, root.assets);
      const restoredAssetPayloads = new Map(assetPayloadsRef.current);
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
            Transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
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
        const storedMaterial = (mesh.material ??
          createDefaultMaterial()) as SceneEntity['material'] & {
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
          transparent: storedMaterial.transparent,
          wireframe: storedMaterial.wireframe,
          emissiveColor: storedMaterial.emissiveColor ?? 0,
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
      commitEntities(parsed);
      setSelectedId(parsed[0]?.id ?? '');
      setWorldName(root.world.name || file.name.replace(/\.world$/i, ''));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDiagnostic({
        level: 'error',
        source: 'World',
        message: `Could not open ${file.name}`,
        details: message,
      });
    }
  };

  const importGlb = async (file?: File) => {
    if (!file) return;
    let pendingLease: AssetResourceLease<ImportedAsset<GlbAsset>> | null = null;
    try {
      const [three, gltf] = await Promise.all([import('three'), import('@engine/gltf-importer')]);
      const { Matrix4, Quaternion, Vector3 } = three;
      const importer = new gltf.GlbImporter();
      if (!glbImporterRegisteredRef.current) {
        assetImportServiceRef.current.register(importer);
        glbImporterRegisteredRef.current = true;
      }
      const sourceBytes = await file.arrayBuffer();
      const safeFileName = file.name.replace(/[\\/]/g, '_').replace(/^\.+/, '') || 'import.glb';
      const uri = `imports/${safeFileName}`;
      const contentHash = await sha256(sourceBytes);
      pendingLease = await assetResourceCacheRef.current.acquire(
        contentHash,
        () =>
          assetImportServiceRef.current.import<GlbAsset>(uri, sourceBytes, {
            signal: new AbortController().signal,
          }),
        () => {
          // CPU mesh buffers are garbage-collected after the final editor lease is released.
        },
      );
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
            opacity: alpha,
            transparent: pbr?.alphaMode === 'BLEND' || alpha < 1,
            wireframe: false,
            emissiveColor,
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
        const imageBytes = image.data.slice();
        const imageBuffer = imageBytes.buffer.slice(
          imageBytes.byteOffset,
          imageBytes.byteOffset + imageBytes.byteLength,
        ) as ArrayBuffer;
        const imageHash = await sha256(imageBuffer);
        const extension =
          image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const textureRecord = stagedRegistry.register({
          name: image.name,
          kind: 'texture',
          uri: `${uri}.image-${imageIndex}.${extension}`,
          contentHash: imageHash,
          importer: { id: 'engine.gltf.embedded-image', version: importer.version, settings: {} },
          dependencies: [],
          metadata: { sourceFormat: 'glb', imageIndex, mimeType: image.mimeType },
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
          data: image.data.slice(),
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
      const message = error instanceof Error ? error.message : String(error);
      pushDiagnostic({
        level: 'error',
        source: 'GLB Importer',
        message: 'Importer engine.gltf.glb failed',
        details: `${file.name}\n${message}`,
      });
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
          return { ...current, position, rotation: lookAtQuaternion(position, [0, 0, 0]) };
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
      return { ...current, position, rotation: lookAtQuaternion(position, [0, 0, 0]) };
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
      return { ...current, position, rotation: lookAtQuaternion(position, [0, 0, 0]) };
    });
  };

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div className="brand-mark">◇</div>
        <strong>UNIVERSAL ENGINE</strong>
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
          </div>
        </details>
        <input
          className="world-name"
          aria-label="World name"
          value={worldName}
          onChange={(event) => setWorldName(event.target.value)}
        />
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
          <i /> EDITOR · INTERACTIVE PREVIEW
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
            </div>
          ) : null}
          <div className="tree-row active">
            ▣ <span>Untitled World</span>
          </div>
          {entities.map((entity) => (
            <button
              key={entity.id}
              className={`tree-row entity-row ${entity.id === selectedId ? 'selected' : ''}`}
              onClick={() => setSelectedId(entity.id)}
            >
              ◈ <span>{entity.name}</span>
            </button>
          ))}
          <div className="panel-foot">{entities.length} OBJECTS · SCENE 01</div>
        </aside>
        <section className="viewport">
          <div className="viewport-label">
            SCENE VIEW <span>WEBGL2</span>
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
                      disabled={!selected}
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
                      disabled={!selected}
                      onClick={() => setTransformAxis(index)}
                    >
                      {axis}
                    </button>
                  ))}
                  <span className="transform-pad-spacer" />
                  <button
                    aria-label={`Decrease ${'XYZ'[transformAxis]}`}
                    disabled={!selected}
                    onClick={() => nudgeSelected(-1)}
                  >
                    −
                  </button>
                  <button
                    aria-label={`Increase ${'XYZ'[transformAxis]}`}
                    disabled={!selected}
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
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => {
              const wasMultiTouch = multiTouchRef.current;
              activePointersRef.current.delete(event.pointerId);
              const drag = dragRef.current;
              dragRef.current = null;
              pinchDistanceRef.current = null;
              if (activePointersRef.current.size === 0) multiTouchRef.current = false;
              if (wasMultiTouch || !drag || drag.pointerId !== event.pointerId) return;
              const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
              if (moved > 4) return;
              const canvas = event.currentTarget;
              const bounds = canvas.getBoundingClientRect();
              const hit = rendererRef.current?.pick(
                event.clientX - bounds.left,
                event.clientY - bounds.top,
                bounds.width,
                bounds.height,
              );
              if (hit) setSelectedId(hit);
            }}
            onPointerCancel={(event) => {
              activePointersRef.current.delete(event.pointerId);
              dragRef.current = null;
              pinchDistanceRef.current = null;
              if (activePointersRef.current.size === 0) multiTouchRef.current = false;
            }}
            onWheel={onWheel}
          />
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
              aria-label="Delete selected object"
              disabled={!selected}
              onClick={removeSelected}
            >
              ⌫
            </button>
          </div>
          {selected ? (
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
              <label>COMPONENTS</label>
              <div className="component">
                ◈ <span>Mesh Renderer</span>
                <small>✓</small>
              </div>
              <div className="component">
                ▧{' '}
                <span>
                  {selected.primitive === 'GLB'
                    ? 'Imported GLB Mesh'
                    : `${selected.primitive} Geometry`}
                </span>
                <small>✓</small>
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              Select an object in the Hierarchy or add a primitive to begin.
            </div>
          )}
          <div className="panel-foot">FOUNDATION BUILD · 0.1.0</div>
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
        <span>● READY</span>
        <span>WebGL2 · Three.js adapter</span>
        <span className="spacer" />
        {entities.length} objects in scene
      </footer>
    </main>
  );
}
