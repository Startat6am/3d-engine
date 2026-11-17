import { EngineHost, EngineRuntime, Transform, defineComponent, type EntityId } from '@engine/core';
import { createBoxGeometry, createUvSphereGeometry, type MeshData } from '@engine/geometry';
import {
  BrowserInputAdapter,
  InputFixedUpdateSystem,
  InputPreUpdateSystem,
  InputSystem,
  type InputDeviceAdapter,
  type InputDeviceSample,
} from '@engine/input';
import {
  PhysicsCollider,
  PhysicsPreUpdateSystem,
  PhysicsSystem,
  RigidBody,
  createPhysicsWorld,
  type PhysicsWorld,
} from '@engine/physics';
import {
  createDefaultCamera,
  createDefaultMaterial,
  ThreeWebGLRendererAdapter,
  type MaterialDescriptor,
  type RenderObject,
} from '@engine/renderer';
import './physics-playground.css';

const canvas = document.querySelector<HTMLCanvasElement>('#playground-canvas');
const rendererState = document.querySelector<HTMLElement>('#renderer-state');
const physicsState = document.querySelector<HTMLElement>('#physics-wasm');
const status = document.querySelector<HTMLElement>('#playground-status');
const bodyCount = document.querySelector<HTMLElement>('#body-count');
const playerPosition = document.querySelector<HTMLElement>('#player-position');
const pauseButton = document.querySelector<HTMLButtonElement>('#pause');
const stepButton = document.querySelector<HTMLButtonElement>('#step');
const raycastButton = document.querySelector<HTMLButtonElement>('#raycast');
const raycastResult = document.querySelector<HTMLOutputElement>('#raycast-result');
const touchHud = document.querySelector<HTMLElement>('#touch-hud');

if (
  !canvas ||
  !rendererState ||
  !physicsState ||
  !status ||
  !bodyCount ||
  !pauseButton ||
  !stepButton ||
  !raycastButton ||
  !raycastResult ||
  !touchHud
) {
  throw new Error('Physics Playground UI is incomplete');
}

const engine = new EngineHost({
  rendererBackends: ['webgl2'],
  supportsWebGL2: true,
  supportsWebGPU: false,
});
let renderer: ThreeWebGLRendererAdapter | null = null;
let physics: PhysicsWorld | null = null;
let physicsSystem: PhysicsSystem | null = null;
let playerEntity: EntityId | null = null;
let inputSystem: InputSystem | null = null;
let animationFrame = 0;
let previousFrame = 0;
let simulationReady = false;
let pendingSingleStep = false;
let lastObservedStepCount = 0;
let disposed = false;

/** Converts held HUD pointers into the same semantic keyboard controls as WASD/Space. */
class TouchHudInputAdapter implements InputDeviceAdapter {
  readonly #pressed = new Map<number, string>();
  readonly #pending: Array<{ source: 'keyboard'; control: string; pressed: boolean }> = [];
  readonly #listeners: Array<() => void> = [];

  constructor(root: HTMLElement) {
    root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
      const control = button.dataset.control!;
      const down = (event: PointerEvent) => {
        event.preventDefault();
        if (this.#pressed.has(event.pointerId)) return;
        this.#pressed.set(event.pointerId, control);
        this.#pending.push({ source: 'keyboard', control, pressed: true });
        try {
          button.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events in automated tests have no active pointer to capture.
        }
        button.dataset.pressed = 'true';
      };
      const up = (event: PointerEvent) => {
        const active = this.#pressed.get(event.pointerId);
        if (!active) return;
        this.#pressed.delete(event.pointerId);
        this.#pending.push({ source: 'keyboard', control: active, pressed: false });
        button.dataset.pressed = 'false';
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('lostpointercapture', up);
      this.#listeners.push(() => {
        button.removeEventListener('pointerdown', down);
        button.removeEventListener('pointerup', up);
        button.removeEventListener('pointercancel', up);
        button.removeEventListener('lostpointercapture', up);
      });
    });
    const releaseAll = () => {
      for (const [pointerId, control] of this.#pressed) {
        this.#pressed.delete(pointerId);
        this.#pending.push({ source: 'keyboard', control, pressed: false });
      }
      root.querySelectorAll<HTMLElement>('[data-control]').forEach((button) => {
        button.dataset.pressed = 'false';
      });
    };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
    this.#listeners.push(() => window.removeEventListener('blur', releaseAll));
    this.#listeners.push(() => document.removeEventListener('visibilitychange', releaseAll));
  }

  sample(): readonly InputDeviceSample[] {
    const transitions = this.#pending.splice(0);
    const values = new Map<string, number>();
    for (const control of this.#pressed.values()) values.set(control, 1);
    return [{ source: 'keyboard', values, transitions }];
  }

  dispose(): void {
    for (const remove of this.#listeners.splice(0)) remove();
    this.#pressed.clear();
    this.#pending.length = 0;
  }
}

const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
const camera = createDefaultCamera();
const Renderable = defineComponent<{ geometry: MeshData; material: MaterialDescriptor }>(
  'Renderable',
);

function addBody(
  position: readonly [number, number, number],
  geometry: MeshData,
  color: number,
  bodyType: 'static' | 'dynamic' | 'kinematic',
  shape:
    | { type: 'box'; halfExtents: readonly [number, number, number] }
    | { type: 'sphere'; radius: number },
) {
  const entity = runtime.world.createEntity();
  runtime.world.add(entity, Transform, {
    position,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    parent: null,
  });
  runtime.world.add(entity, Renderable, { geometry, material: createDefaultMaterial(color) });
  runtime.world.add(entity, RigidBody, { type: bodyType, position, rotation: [0, 0, 0, 1] });
  runtime.world.add(entity, PhysicsCollider, { shape, friction: 0.8, restitution: 0.08 });
  return entity;
}

function renderFrame(now: number) {
  if (disposed || !renderer) return;
  const delta = previousFrame === 0 ? 0 : Math.min(0.25, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  runtime.advance(delta);
  if (playerEntity) {
    const transform = runtime.world.get(playerEntity, Transform);
    if (transform)
      playerPosition!.textContent = `PLAYER X ${transform.position[0].toFixed(2)} · Y ${transform.position[1].toFixed(2)} · Z ${transform.position[2].toFixed(2)}`;
  }
  const currentStepCount = physicsSystem?.stepCount ?? 0;
  if (!simulationReady && currentStepCount > 0) {
    simulationReady = true;
    status!.dataset.state = 'running';
    status!.textContent = 'RUNNING';
    pauseButton!.disabled = false;
    stepButton!.disabled = false;
    raycastButton!.disabled = false;
  }
  if (pendingSingleStep && currentStepCount > lastObservedStepCount) {
    pendingSingleStep = false;
    stepButton!.disabled = false;
    status!.dataset.state = 'paused';
    status!.textContent = 'PAUSED · STEP COMPLETE';
  }
  lastObservedStepCount = currentStepCount;
  const objects: RenderObject[] = [];
  runtime.world.query(Renderable).forEach((entity, value) => {
    const renderable = value as { geometry: MeshData; material: MaterialDescriptor };
    const worldMatrix = runtime.hierarchy.getWorldMatrix(entity);
    if (!worldMatrix) return;
    objects.push({
      id: entity,
      geometry: renderable.geometry,
      material: renderable.material,
      worldMatrix,
    });
  });
  renderer.resize(window.innerWidth, Math.max(1, window.innerHeight - 80));
  renderer.render({ camera, background: 0x111722, objects });
  animationFrame = window.requestAnimationFrame(renderFrame);
}

async function start() {
  try {
    renderer = new ThreeWebGLRendererAdapter(canvas!);
    engine.register({ stop: () => renderer?.dispose() });
    await engine.start();
    rendererState!.dataset.state = 'ready';
    rendererState!.textContent = 'WEBGL2 READY';

    physics = await createPhysicsWorld({ gravity: [0, -9.81, 0] });
    physicsState!.dataset.state = 'ready';
    physicsState!.textContent = 'WASM READY';

    addBody([0, -0.5, 0], createBoxGeometry(20, 1, 20), 0x34445a, 'static', {
      type: 'box',
      halfExtents: [10, 0.5, 10],
    });
    playerEntity = addBody([0, 2.5, 0], createUvSphereGeometry(0.5, 24, 16), 0xf0a64b, 'dynamic', {
      type: 'sphere',
      radius: 0.5,
    });
    addBody([-1.5, 1, 0], createBoxGeometry(), 0x6fa9ed, 'dynamic', {
      type: 'box',
      halfExtents: [0.5, 0.5, 0.5],
    });
    addBody([1.5, 1.5, 0], createBoxGeometry(), 0x70c5a0, 'dynamic', {
      type: 'box',
      halfExtents: [0.5, 0.5, 0.5],
    });
    addBody([0, 0.5, -2], createBoxGeometry(2, 0.3, 1), 0x9a8de0, 'kinematic', {
      type: 'box',
      halfExtents: [1, 0.15, 0.5],
    });

    inputSystem = new InputSystem();
    inputSystem.addAdapter(new BrowserInputAdapter(window));
    inputSystem.addAdapter(new TouchHudInputAdapter(touchHud!));
    inputSystem.addContext({
      id: 'gameplay',
      priority: 0,
      map: {
        id: 'playground-controls',
        actions: [
          { name: 'Move', kind: 'axis2D' },
          { name: 'Jump', kind: 'button' },
        ],
        bindings: [
          { action: 'Move', source: 'keyboard', control: 'KeyD', component: 'x' },
          { action: 'Move', source: 'keyboard', control: 'KeyA', component: 'x', scale: -1 },
          { action: 'Move', source: 'keyboard', control: 'KeyW', component: 'y' },
          { action: 'Move', source: 'keyboard', control: 'KeyS', component: 'y', scale: -1 },
          { action: 'Jump', source: 'keyboard', control: 'Space' },
          { action: 'Jump', source: 'mouse', control: 'Button0' },
        ],
      },
    });

    physicsSystem = new PhysicsSystem(physics);
    runtime.scheduler.add(new InputPreUpdateSystem(inputSystem));
    runtime.scheduler.add(new PhysicsPreUpdateSystem(physicsSystem));
    runtime.scheduler.add(new InputFixedUpdateSystem(inputSystem));
    runtime.scheduler.add({
      phase: 'fixed-update',
      update: () => {
        if (physics!.paused) return;
        const snapshot = inputSystem!.snapshot('gameplay');
        const handle = physicsSystem!.getBodyHandle(playerEntity!);
        if (!handle) return;
        const [x, z] = snapshot.getAxis2D('Move');
        if (x !== 0 || z !== 0) physics!.applyForce(handle, [x * 10, 0, -z * 10]);
        if (snapshot.wasPressed('Jump')) physics!.applyImpulse(handle, [0, 4.5, 0]);
      },
    });
    runtime.scheduler.add(physicsSystem);

    let count = 0;
    runtime.world.query(RigidBody).forEach(() => {
      count += 1;
    });
    bodyCount!.textContent = `${count} bodies`;
    status!.dataset.state = 'initializing';
    status!.textContent = 'WAITING FOR FIRST FIXED TICK';
    animationFrame = window.requestAnimationFrame(renderFrame);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    inputSystem?.dispose();
    physicsSystem?.dispose();
    physics?.dispose();
    void engine.dispose();
    status!.dataset.state = 'error';
    status!.textContent = `ERROR · ${message}`;
    physicsState!.dataset.state = 'error';
    physicsState!.textContent = 'PHYSICS UNAVAILABLE';
    rendererState!.dataset.state = renderer ? 'ready' : 'error';
    rendererState!.textContent = renderer ? 'WEBGL2 READY' : 'RENDERER UNAVAILABLE';
    console.error('Physics Playground failed to initialize', error);
  }
}

pauseButton.addEventListener('click', () => {
  if (!physics) return;
  const nextPaused = !physics.paused;
  physics.setPaused(nextPaused);
  if (!nextPaused && pendingSingleStep) {
    pendingSingleStep = false;
    stepButton!.disabled = false;
  }
  pauseButton.textContent = nextPaused ? 'Resume' : 'Pause';
  status!.dataset.state = nextPaused ? 'paused' : 'running';
  status!.textContent = nextPaused ? 'PAUSED' : 'RUNNING';
});

stepButton.addEventListener('click', () => {
  if (!physics) return;
  if (!physics.paused) {
    physics.setPaused(true);
    pauseButton.textContent = 'Resume';
  }
  physics.requestSingleStep();
  pendingSingleStep = true;
  stepButton.disabled = true;
  status!.dataset.state = 'paused';
  status!.textContent = 'PAUSED · STEP QUEUED';
});

raycastButton.addEventListener('click', () => {
  if (!physics) return;
  const hit = physics.raycast({ origin: [0, 8, 0], direction: [0, -1, 0], maxDistance: 20 });
  raycastResult.textContent = hit
    ? `Hit entity ${hit.entity} at ${hit.distance.toFixed(2)} m`
    : 'No hit';
});

window.addEventListener(
  'pagehide',
  () => {
    disposed = true;
    window.cancelAnimationFrame(animationFrame);
    inputSystem?.dispose();
    physicsSystem?.dispose();
    physics?.dispose();
    void engine.dispose();
  },
  { once: true },
);

void start();
