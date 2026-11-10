import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { GlbImporter } from '@engine/gltf-importer';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
  ThreeWebGLRendererAdapter,
  type RenderObject,
  type Vec3,
} from '@engine/renderer';

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
type SceneEntity = RenderObject & {
  readonly name: string;
  readonly primitive: Primitive | 'GLB';
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
    setSelectedId((current) => previous.some((entity) => entity.id === current) ? current : (previous[0]?.id ?? ''));
  }, []);

  const redo = useCallback(() => {
    const next = history.current.redo(entitiesRef.current);
    if (!next) return;
    entitiesRef.current = next;
    setEntities(next);
    setHistoryVersion((version) => version + 1);
    setSelectedId((current) => next.some((entity) => entity.id === current) ? current : (next[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (editingText || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) { event.preventDefault(); redo(); }
      else if (key === 'z') { event.preventDefault(); undo(); }
      else if (key === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);
  const [selectedId, setSelectedId] = useState('entity-1');
  const [rendererError, setRendererError] = useState('');
  const [worldName, setWorldName] = useState('Untitled World');
  const [worldError, setWorldError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(() => createDefaultCamera());
  const dragRef = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);
  const selected = entities.find((entity) => entity.id === selectedId) ?? null;

  const renderScene = useMemo(
    () => ({
      camera,
      background: 0x151a23,
      objects: entities.map((entity) => ({
        ...entity,
        material:
          entity.id === selectedId
            ? { ...entity.material, color: entity.material.color }
            : entity.material,
      })),
    }),
    [camera, entities, selectedId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ThreeWebGLRendererAdapter;
    try {
      renderer = new ThreeWebGLRendererAdapter(canvas);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      canvas.dataset.rendererError = message;
      setRendererError(message);
      console.error('WebGL2 renderer initialization failed', error);
      return;
    }
    canvas.dataset.renderer = renderer.capabilities.backend;
    rendererRef.current = renderer;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height);
      renderer.render(renderScene);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
    // Renderer lifetime is tied to the canvas; scene updates are handled below.
  }, []);

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

  const renameSelected = (name: string) => {
    if (!selected || !name.trim()) return;
    commitEntities(entities.map((entity) =>
      entity.id === selectedId ? { ...entity, name: name.trim() } : entity,
    ));
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
        entities: entities.map(({ id, name, primitive, position, rotation, scale, material, geometry }) => ({
          id,
          name,
          parent: null,
          components: {
            Transform: { position, rotation, scale },
            MeshRenderer: { primitive, material, ...(primitive === 'GLB' ? { geometry: { positions: Array.from(geometry.positions), normals: Array.from(geometry.normals), indices: Array.from(geometry.indices) } } : {}) },
          },
        })),
      },
      assets: [],
      extensions: {},
    };
    const blob = new Blob([serializeWorld(worldDocument)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'world'}.world`;
    anchor.click();
    URL.revokeObjectURL(url);
    setWorldError('');
  };

  const loadWorld = async (file?: File) => {
    if (!file) return;
    try {
      const root = parseWorld(await file.text());
      const parsed: SceneEntity[] = root.world.entities.map((entry, index) => {
        if (!entry || typeof entry !== 'object')
          throw new Error(`Invalid entity at index ${index}`);
        const entity = entry as {
          id?: string;
          name?: string;
          components?: {
            Transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
            MeshRenderer?: { primitive?: Primitive | 'GLB'; material?: SceneEntity['material']; geometry?: { positions?: number[]; normals?: number[]; indices?: number[] } };
          };
        };
        const transform = entity.components?.Transform;
        const mesh = entity.components?.MeshRenderer;
        const primitive = mesh?.primitive;
        let geometry: MeshData;
        if (primitive === 'GLB') {
          const source = mesh?.geometry;
          if (!source || !Array.isArray(source.positions) || !Array.isArray(source.normals) || !Array.isArray(source.indices) || ![...source.positions, ...source.normals].every(Number.isFinite) || !source.indices.every((index) => Number.isInteger(index) && index >= 0)) throw new Error(`Entity ${entity.name} has invalid imported mesh buffers`);
          geometry = { positions: Float32Array.from(source.positions), normals: Float32Array.from(source.normals), indices: Uint32Array.from(source.indices) };
          validateMeshData(geometry);
        } else if (primitive && primitive in geometryFor) {
          geometry = geometryFor[primitive]();
        } else {
          throw new Error(`Entity ${index} has an unsupported geometry type`);
        }
        if (
          !entity.id ||
          !entity.name ||
          !transform ||
          !mesh ||
          !primitive
        )
          throw new Error(`Entity ${index} is missing supported Transform or MeshRenderer data`);
        const vector = (value: number[] | undefined, length: number, fallback: number[]) => {
          if (!value) return fallback;
          if (value.length !== length || value.some((n) => !Number.isFinite(n)))
            throw new Error(`Entity ${entity.name} has invalid transform values`);
          return value;
        };
        return {
          id: entity.id,
          name: entity.name,
          primitive,
          geometry,
          material: mesh.material ?? createDefaultMaterial(),
          position: vector(transform.position, 3, [0, 0, 0]) as [number, number, number],
          rotation: vector(transform.rotation, 4, [0, 0, 0, 1]) as [number, number, number, number],
          scale: vector(transform.scale, 3, [1, 1, 1]) as [number, number, number],
        };
      });
      if (new Set(parsed.map((item) => item.id)).size !== parsed.length)
        throw new Error('World contains duplicate entity IDs');
      commitEntities(parsed);
      setSelectedId(parsed[0]?.id ?? '');
      setWorldName(root.world.name || file.name.replace(/\.world$/i, ''));
      setWorldError('');
    } catch (error) {
      setWorldError(error instanceof Error ? error.message : String(error));
    }
  };

  const importGlb = async (file?: File) => {
    if (!file) return;
    try {
      const imported = await new GlbImporter().import(await file.arrayBuffer(), { uri: file.name || 'import.glb', settings: {}, signal: new AbortController().signal });
      const asset = imported.data;
      const parentOf = new Map<number, number>();
      asset.nodes.forEach((node, parent) => node.children.forEach((child) => parentOf.set(child, parent)));
      if (asset.nodes.some((node) => node.matrix)) throw new Error('Editor import currently supports TRS node transforms, not matrix-authored nodes');
      if ([...parentOf.keys()].some((index) => asset.nodes[index]?.mesh !== null && asset.nodes[index]?.mesh !== undefined)) throw new Error('Nested mesh nodes are not yet supported; import a flattened GLB scene');
      const instances = asset.nodes.map((node, nodeIndex) => ({ node, nodeIndex })).filter(({ node }) => node.mesh !== null);
      const sources = instances.length
        ? instances.flatMap(({ node, nodeIndex }) => asset.meshes[node.mesh!]!.primitives.map((primitive, primitiveIndex) => ({ name: node.name || asset.meshes[node.mesh!]!.name, primitive, position: node.translation, rotation: node.rotation, scale: node.scale, key: `${nodeIndex}-${primitiveIndex}` })))
        : asset.meshes.flatMap((mesh, meshIndex) => mesh.primitives.map((primitive, primitiveIndex) => ({ name: mesh.name, primitive, position: [0, 0, 0] as const, rotation: [0, 0, 0, 1] as const, scale: [1, 1, 1] as const, key: `${meshIndex}-${primitiveIndex}` })));
      if (!sources.length) throw new Error('The GLB contains no renderable triangle meshes');
      const importedEntities: SceneEntity[] = sources.map((source, index) => {
        const pbr = source.primitive.material === null ? undefined : asset.materials[source.primitive.material];
        const factor = pbr?.baseColorFactor ?? [0.72, 0.76, 0.82, 1];
        const toSrgb = (value: number) => { const linear = Math.min(1, Math.max(0, value)); return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055; };
        const color = factor.slice(0, 3).reduce((hex, value) => (hex << 8) | Math.round(toSrgb(value!) * 255), 0);
        const alpha = Math.min(1, Math.max(0, factor[3] ?? 1));
        return { id: `glb-${Date.now()}-${index}-${source.key}`, name: sources.length === 1 ? source.name : `${source.name} · ${index + 1}`, primitive: 'GLB', geometry: source.primitive.mesh, material: { color, roughness: pbr?.roughnessFactor ?? 1, metalness: pbr?.metallicFactor ?? 1, opacity: alpha, transparent: pbr?.alphaMode === 'BLEND' || alpha < 1, wireframe: false }, position: source.position, rotation: source.rotation, scale: source.scale };
      });
      commitEntities([...entitiesRef.current, ...importedEntities]);
      setSelectedId(importedEntities[0]!.id);
      setWorldError('');
    } catch (error) { setWorldError(error instanceof Error ? error.message : String(error)); }
  };

  const resetCamera = () => setCamera(createDefaultCamera());

  const removeSelected = () => {
    if (!selected) return;
    const next = entities.filter((entity) => entity.id !== selectedId);
    commitEntities(next);
    setSelectedId(next[0]?.id ?? '');
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
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
        <input
          className="world-name"
          aria-label="World name"
          value={worldName}
          onChange={(event) => setWorldName(event.target.value)}
        />
        <button className="toolbar-button" onClick={undo} disabled={!history.current.canUndo} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button className="toolbar-button" onClick={redo} disabled={!history.current.canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </button>
        <button className="toolbar-button" onClick={saveWorld}>
          Save .world
        </button>
        <button className="toolbar-button" onClick={() => fileInputRef.current?.click()}>
          Open .world
        </button>
        <button className="toolbar-button" onClick={() => glbInputRef.current?.click()}>Import .glb</button>
        <input ref={glbInputRef} hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => { void importGlb(event.target.files?.[0]); event.currentTarget.value = ''; }} />
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
        <span className="spacer" />
        <span className="status">
          <i /> EDITOR · INTERACTIVE PREVIEW
        </span>
      </header>
      <div className="workspace">
        <aside className="panel hierarchy">
          <div className="panel-heading">
            HIERARCHY{' '}
            <button aria-label="Add entity" onClick={() => addEntity('Box')}>
              ＋
            </button>
          </div>
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
          <div className="tree-actions">
            <button onClick={() => addEntity('Box')}>＋ Box</button>
            <button onClick={() => addEntity('Sphere')}>＋ Sphere</button>
            <button onClick={() => addEntity('Plane')}>＋ Plane</button>
            <button onClick={() => addEntity('Cylinder')}>＋ Cylinder</button>
          </div>
          {worldError ? (
            <div className="world-error" role="alert">
              {worldError}
            </div>
          ) : null}
          <div className="panel-foot">{entities.length} OBJECTS · SCENE 01</div>
        </aside>
        <section className="viewport">
          <div className="viewport-label">
            SCENE VIEW <span>WEBGL2</span>
            <button onClick={resetCamera}>Reset Camera</button>
          </div>
          <canvas
            ref={canvasRef}
            aria-label="3D scene viewport"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => {
              const drag = dragRef.current;
              dragRef.current = null;
              if (!drag || drag.pointerId !== event.pointerId) return;
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
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onWheel={onWheel}
          />
          <div className="axis">
            X <b>Y</b> Z
          </div>
          <div className="viewport-help">
            Drag · Orbit <span>Scroll · Zoom</span>
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
                ▧ <span>{selected.primitive === 'GLB' ? 'Imported GLB Mesh' : `${selected.primitive} Geometry`}</span>
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
      <footer className="bottombar">
        <span>● READY</span>
        <span>WebGL2 · Three.js adapter</span>
        <span className="spacer" />
        {entities.length} objects in scene
      </footer>
    </main>
  );
}
