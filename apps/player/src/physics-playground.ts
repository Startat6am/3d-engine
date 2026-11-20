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
  lookAtQuaternion,
  ThreeWebGLRendererAdapter,
  type MaterialDescriptor,
  type RenderObject,
} from '@engine/renderer';
import './physics-playground.css';
import { attachFpsCounter } from './fps-counter.js';

const canvas = document.querySelector<HTMLCanvasElement>('#playground-canvas');
const rendererState = document.querySelector<HTMLElement>('#renderer-state');
const physicsState = document.querySelector<HTMLElement>('#physics-wasm');
const status = document.querySelector<HTMLElement>('#playground-status');
const bodyCount = document.querySelector<HTMLElement>('#body-count');
const playerPosition = document.querySelector<HTMLElement>('#player-position');
const characterState = document.querySelector<HTMLElement>('#character-state');
const pauseButton = document.querySelector<HTMLButtonElement>('#pause');
const stepButton = document.querySelector<HTMLButtonElement>('#step');
const raycastButton = document.querySelector<HTMLButtonElement>('#raycast');
const resetSceneButton = document.querySelector<HTMLButtonElement>('#reset-scene');
const raycastResult = document.querySelector<HTMLOutputElement>('#raycast-result');
const touchHud = document.querySelector<HTMLElement>('#touch-hud');
const cameraModeButton = document.querySelector<HTMLButtonElement>('#camera-mode');

if (
  !canvas ||
  !rendererState ||
  !physicsState ||
  !status ||
  !bodyCount ||
  !pauseButton ||
  !stepButton ||
  !raycastButton ||
  !resetSceneButton ||
  !raycastResult ||
  !touchHud ||
  !cameraModeButton
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
let playerBodyHandle: ReturnType<PhysicsWorld['createBody']> | null = null;
let playerControllerHandle: ReturnType<PhysicsWorld['createCharacterController']> | null = null;
let characterVerticalVelocity = 0;
let characterGrounded = false;
let characterCollisionCount = 0;
let characterHorizontalSpeed = 0;
let characterResetPending = false;
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
  #stickPointerId: number | null = null;
  #stickAxes: [number, number] = [0, 0];

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
    const joystick = root.querySelector<HTMLElement>('#move-joystick');
    const joystickKnob = root.querySelector<HTMLElement>('.touch-joystick-knob');
    if (joystick && joystickKnob) {
      const resetStick = () => {
        this.#stickPointerId = null;
        this.#stickAxes = [0, 0];
        joystickKnob.style.setProperty('--stick-x', '0px');
        joystickKnob.style.setProperty('--stick-y', '0px');
        joystick.dataset.active = 'false';
      };
      const moveStick = (event: PointerEvent) => {
        if (this.#stickPointerId !== event.pointerId) return;
        event.preventDefault();
        const bounds = joystick.getBoundingClientRect();
        const travel = Math.max(
          1,
          bounds.width / 2 - joystickKnob.getBoundingClientRect().width / 2,
        );
        let x = (event.clientX - (bounds.left + bounds.width / 2)) / travel;
        let y = (event.clientY - (bounds.top + bounds.height / 2)) / travel;
        const magnitude = Math.hypot(x, y);
        if (magnitude > 1) {
          x /= magnitude;
          y /= magnitude;
        }
        this.#stickAxes = [x, -y];
        joystickKnob.style.setProperty('--stick-x', `${x * travel}px`);
        joystickKnob.style.setProperty('--stick-y', `${y * travel}px`);
      };
      const down = (event: PointerEvent) => {
        event.preventDefault();
        if (this.#stickPointerId !== null) return;
        this.#stickPointerId = event.pointerId;
        joystick.dataset.active = 'true';
        try {
          joystick.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events in automated tests have no active pointer to capture.
        }
        moveStick(event);
      };
      const up = (event: PointerEvent) => {
        if (this.#stickPointerId !== event.pointerId) return;
        resetStick();
      };
      joystick.addEventListener('pointerdown', down);
      joystick.addEventListener('pointermove', moveStick);
      joystick.addEventListener('pointerup', up);
      joystick.addEventListener('pointercancel', up);
      joystick.addEventListener('lostpointercapture', up);
      this.#listeners.push(() => {
        joystick.removeEventListener('pointerdown', down);
        joystick.removeEventListener('pointermove', moveStick);
        joystick.removeEventListener('pointerup', up);
        joystick.removeEventListener('pointercancel', up);
        joystick.removeEventListener('lostpointercapture', up);
      });
      this.#listeners.push(resetStick);
    }
    const releaseAll = () => {
      for (const [pointerId, control] of this.#pressed) {
        this.#pressed.delete(pointerId);
        this.#pending.push({ source: 'keyboard', control, pressed: false });
      }
      root.querySelectorAll<HTMLElement>('[data-control]').forEach((button) => {
        button.dataset.pressed = 'false';
      });
      this.#stickPointerId = null;
      this.#stickAxes = [0, 0];
      if (joystick && joystickKnob) {
        joystick.dataset.active = 'false';
        joystickKnob.style.setProperty('--stick-x', '0px');
        joystickKnob.style.setProperty('--stick-y', '0px');
      }
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
    const [x, y] = this.#stickAxes;
    if (x > 0) values.set('KeyD', Math.max(values.get('KeyD') ?? 0, x));
    if (x < 0) values.set('KeyA', Math.max(values.get('KeyA') ?? 0, -x));
    if (y > 0) values.set('KeyW', Math.max(values.get('KeyW') ?? 0, y));
    if (y < 0) values.set('KeyS', Math.max(values.get('KeyS') ?? 0, -y));
    return [{ source: 'keyboard', values, transitions }];
  }

  dispose(): void {
    for (const remove of this.#listeners.splice(0)) remove();
    this.#pressed.clear();
    this.#pending.length = 0;
  }
}

const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
const updateFps = attachFpsCounter(canvas);
const camera = createDefaultCamera();
let cameraOrbitEnabled = false;
let cameraOrbitPointerX = 0;
let cameraOrbitPointerY = 0;
let cameraAzimuth = Math.atan2(camera.position[0], camera.position[2]);
let cameraElevation = Math.atan2(
  camera.position[1],
  Math.hypot(camera.position[0], camera.position[2]),
);
const cameraOrbitRadius = Math.hypot(camera.position[0], camera.position[1], camera.position[2]);
const cameraOrbitSensitivity = 0.006;
const cameraOrbitMinElevation = -1.2;
const cameraOrbitMaxElevation = 1.2;

function updateOrbitCamera() {
  if (!cameraOrbitEnabled || !playerEntity) return;
  const transform = runtime.world.get(playerEntity, Transform);
  if (!transform) return;
  const target: [number, number, number] = [
    transform.position[0],
    transform.position[1] + 0.25,
    transform.position[2],
  ];
  const horizontal = Math.cos(cameraElevation) * cameraOrbitRadius;
  const position: [number, number, number] = [
    target[0] + Math.sin(cameraAzimuth) * horizontal,
    target[1] + Math.sin(cameraElevation) * cameraOrbitRadius,
    target[2] + Math.cos(cameraAzimuth) * horizontal,
  ];
  Object.assign(camera, { position, rotation: lookAtQuaternion(position, target) });
}

function setCameraOrbitEnabled(enabled: boolean) {
  cameraOrbitEnabled = enabled;
  cameraModeButton!.dataset.active = String(enabled);
  cameraModeButton!.setAttribute('aria-pressed', String(enabled));
  cameraModeButton!.textContent = enabled ? 'CAMERA ON' : 'CAMERA';
  canvas!.dataset.cameraMode = String(enabled);
  if (enabled) updateOrbitCamera();
}

let cameraHoldPointerId: number | null = null;
cameraModeButton.addEventListener('pointerdown', (event) => {
  if (cameraHoldPointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  cameraHoldPointerId = event.pointerId;
  cameraOrbitPointerX = event.clientX;
  cameraOrbitPointerY = event.clientY;
  setCameraOrbitEnabled(true);
  try {
    cameraModeButton!.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture may be unavailable for synthetic test events.
  }
});
const releaseCameraHold = (event: PointerEvent) => {
  if (cameraHoldPointerId !== event.pointerId) return;
  cameraHoldPointerId = null;
  setCameraOrbitEnabled(false);
};
cameraModeButton.addEventListener('pointerup', releaseCameraHold);
cameraModeButton.addEventListener('pointercancel', releaseCameraHold);
cameraModeButton.addEventListener('lostpointercapture', releaseCameraHold);
cameraModeButton.addEventListener('keydown', (event) => {
  if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) {
    event.preventDefault();
    setCameraOrbitEnabled(true);
  }
});
cameraModeButton.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || event.code === 'Enter') setCameraOrbitEnabled(false);
});
window.addEventListener('pointermove', (event) => {
  if (!cameraOrbitEnabled) return;
  // While the camera button is held, pointer movement anywhere rotates the view.
  const deltaX = event.clientX - cameraOrbitPointerX;
  const deltaY = event.clientY - cameraOrbitPointerY;
  cameraOrbitPointerX = event.clientX;
  cameraOrbitPointerY = event.clientY;
  cameraAzimuth -= deltaX * cameraOrbitSensitivity;
  canvas!.dataset.cameraAzimuth = cameraAzimuth.toFixed(3);
  cameraElevation = Math.max(
    cameraOrbitMinElevation,
    Math.min(cameraOrbitMaxElevation, cameraElevation + deltaY * cameraOrbitSensitivity),
  );
});
window.addEventListener('blur', () => {
  cameraHoldPointerId = null;
  setCameraOrbitEnabled(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    cameraHoldPointerId = null;
    setCameraOrbitEnabled(false);
  }
});

const Renderable = defineComponent<{ geometry: MeshData; material: MaterialDescriptor }>(
  'Renderable',
);
const initialDynamicPoses = new Map<
  EntityId,
  {
    position: readonly [number, number, number];
    rotation: readonly [number, number, number, number];
  }
>();

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
  const rotation = [0, 0, 0, 1] as const;
  runtime.world.add(entity, RigidBody, {
    type: bodyType,
    position,
    rotation,
    linearDamping: bodyType === 'dynamic' ? 3 : 0,
  });
  if (bodyType === 'dynamic') initialDynamicPoses.set(entity, { position, rotation });
  runtime.world.add(entity, PhysicsCollider, { shape, friction: 0.8, restitution: 0.08 });
  return entity;
}

function renderFrame(now: number) {
  updateFps(now);
  if (disposed || !renderer) return;
  const delta = previousFrame === 0 ? 0 : Math.min(0.25, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  runtime.advance(delta);
  if (playerEntity && playerBodyHandle && physics) {
    const transform = runtime.world.get(playerEntity, Transform);
    const pose = physics.getPose(playerBodyHandle);
    if (transform) {
      transform.position = [...pose.position];
      transform.rotation = [...pose.rotation];
      playerPosition!.textContent = `PLAYER X ${pose.position[0].toFixed(2)} · Y ${pose.position[1].toFixed(2)} · Z ${pose.position[2].toFixed(2)}`;
      characterState!.textContent = `${characterGrounded ? 'GROUNDED' : 'AIRBORNE'} · ${characterHorizontalSpeed.toFixed(2)} m/s · ${characterCollisionCount} contacts`;
      characterState!.dataset.state = characterGrounded ? 'grounded' : 'airborne';
    }
  }
  const currentStepCount = physicsSystem?.stepCount ?? 0;
  if (!simulationReady && currentStepCount > 0) {
    simulationReady = true;
    status!.dataset.state = 'running';
    status!.textContent = 'RUNNING';
    pauseButton!.disabled = false;
    stepButton!.disabled = false;
    raycastButton!.disabled = false;
    resetSceneButton!.disabled = false;
  }
  if (pendingSingleStep && currentStepCount > lastObservedStepCount) {
    pendingSingleStep = false;
    stepButton!.disabled = false;
    status!.dataset.state = 'paused';
    status!.textContent = 'PAUSED · STEP COMPLETE';
  }
  lastObservedStepCount = currentStepCount;
  updateOrbitCamera();
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
    // The player is a real kinematic capsule. Rapier's character controller resolves
    // terrain contacts and autostep; the stretched sphere is only its visible shell.
    playerEntity = runtime.world.createEntity();
    const spawnPosition = [-3, 0.91, 0] as const;
    runtime.world.add(playerEntity, Transform, {
      position: spawnPosition,
      rotation: [0, 0, 0, 1],
      scale: [0.72, 1.8, 0.72],
      parent: null,
    });
    runtime.world.add(playerEntity, Renderable, {
      geometry: createUvSphereGeometry(0.5, 24, 16),
      material: createDefaultMaterial(0xf0a64b),
    });
    playerBodyHandle = physics.createBody(playerEntity, {
      type: 'kinematic',
      position: spawnPosition,
      canSleep: false,
    });
    const playerCollider = physics.createCollider(playerBodyHandle, {
      shape: { type: 'capsule', halfHeight: 0.55, radius: 0.35 },
      friction: 0.8,
      restitution: 0,
    });
    playerControllerHandle = physics.createCharacterController(playerCollider, {
      offset: 0.02,
      maxSlopeClimbAngle: Math.PI / 4,
      minSlopeSlideAngle: Math.PI / 4,
      autostep: { maxHeight: 0.34, minWidth: 0.22 },
      snapToGroundDistance: 0.18,
    });

    // A compact voxel-like obstacle course: four climbable blocks, a raised deck,
    // and two columns for checking side and corner collisions.
    for (let index = 0; index < 4; index += 1) {
      const height = 0.3 * (index + 1);
      addBody(
        [2 + index * 1.2, height / 2, 0],
        createBoxGeometry(1.2, height, 2.4),
        [0x6fa9ed, 0x70c5a0, 0x9a8de0, 0xd49a65][index]!,
        'static',
        { type: 'box', halfExtents: [0.6, height / 2, 1.2] },
      );
    }
    addBody([1, 0.45, -3], createBoxGeometry(1.4, 0.9, 1.4), 0x78909c, 'static', {
      type: 'box',
      halfExtents: [0.7, 0.45, 0.7],
    });
    addBody([4.5, 1, -3], createBoxGeometry(1.4, 2, 1.4), 0x78909c, 'static', {
      type: 'box',
      halfExtents: [0.7, 1, 0.7],
    });
    addBody([-1.5, 1, 3], createBoxGeometry(), 0x6fa9ed, 'dynamic', {
      type: 'box',
      halfExtents: [0.5, 0.5, 0.5],
    });
    addBody([1.5, 1.5, 3], createBoxGeometry(), 0x70c5a0, 'dynamic', {
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
        if (!playerControllerHandle || !playerBodyHandle) return;
        if (characterResetPending) {
          characterResetPending = false;
          return;
        }
        const [x, z] = snapshot.getAxis2D('Move');
        const magnitude = Math.hypot(x, z);
        const speed = 4.2;
        const directionX = magnitude > 1 ? x / magnitude : x;
        const directionZ = magnitude > 1 ? z / magnitude : z;
        if (snapshot.wasPressed('Jump') && characterGrounded) {
          characterVerticalVelocity = 6.2;
          characterGrounded = false;
        }
        characterVerticalVelocity = Math.max(-24, characterVerticalVelocity - 9.81 / 60);
        const movement = physics!.moveCharacterController(playerControllerHandle, [
          (directionX * speed) / 60,
          characterVerticalVelocity / 60,
          (-directionZ * speed) / 60,
        ]);
        characterGrounded = movement.grounded;
        characterCollisionCount = movement.collisions.length;
        if (characterGrounded && characterVerticalVelocity < 0) characterVerticalVelocity = 0;
        characterHorizontalSpeed =
          Math.hypot(movement.translation[0], movement.translation[2]) * 60;
        if (characterState) characterState.dataset.speed = characterHorizontalSpeed.toFixed(2);
      },
    });
    runtime.scheduler.add(physicsSystem);

    let count = 0;
    runtime.world.query(RigidBody).forEach(() => {
      count += 1;
    });
    bodyCount!.textContent = `${count + (playerBodyHandle ? 1 : 0)} bodies`;
    status!.dataset.state = 'initializing';
    status!.textContent = 'WAITING FOR FIRST FIXED TICK';
    animationFrame = window.requestAnimationFrame(renderFrame);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    inputSystem?.dispose();
    physicsSystem?.dispose();
    if (playerControllerHandle && physics)
      physics.removeCharacterController(playerControllerHandle);
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

resetSceneButton.addEventListener('click', () => {
  if (!physics || !physicsSystem) return;
  if (playerBodyHandle && playerEntity && physics) {
    const spawn = { position: [-3, 0.91, 0] as const, rotation: [0, 0, 0, 1] as const };
    physics.setKinematicTarget(playerBodyHandle, spawn);
    const transform = runtime.world.get(playerEntity, Transform);
    if (transform) transform.position = [...spawn.position];
    characterVerticalVelocity = 0;
    characterGrounded = false;
    characterCollisionCount = 0;
    characterHorizontalSpeed = 0;
    characterResetPending = true;
  }
  for (const [entity, pose] of initialDynamicPoses) {
    const handle = physicsSystem.getBodyHandle(entity);
    if (!handle) continue;
    physics.setDynamicPose(handle, pose);
    const transform = runtime.world.get(entity, Transform);
    if (transform) {
      transform.position = [...pose.position];
      transform.rotation = [...pose.rotation];
    }
  }
  if (physics.paused) physics.setPaused(false);
  pendingSingleStep = false;
  stepButton.disabled = false;
  pauseButton.textContent = 'Pause';
  status.dataset.state = 'running';
  status.textContent = 'RUNNING · SCENE RESET';
  raycastResult.textContent = 'Raycast not run';
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
    if (playerControllerHandle && physics)
      physics.removeCharacterController(playerControllerHandle);
    physics?.dispose();
    void engine.dispose();
  },
  { once: true },
);

void start();
