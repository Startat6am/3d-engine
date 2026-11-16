import { describe, expect, it } from 'vitest';
import { EngineRuntime } from '@engine/core';
import { RapierPhysicsWorld, setRapierModuleLoaderForTests } from './rapier-world.js';

async function createTestPhysics(
  options: {
    readonly gravity?: readonly [number, number, number];
    readonly limits?: {
      readonly maxBodies?: number;
      readonly maxColliders?: number;
      readonly maxCollisionEventsPerDrain?: number;
      readonly maxRayDistance?: number;
      readonly maxConvexHullVertices?: number;
      readonly maxTriangleMeshVertices?: number;
      readonly maxTriangleMeshIndices?: number;
    };
  } = {},
) {
  setRapierModuleLoaderForTests(async () => {
    const rapier = await import('@dimforge/rapier3d-compat');
    await rapier.init();
    return rapier as unknown as typeof import('@dimforge/rapier3d');
  });
  try {
    return await RapierPhysicsWorld.create(options);
  } finally {
    setRapierModuleLoaderForTests(null);
  }
}

describe('RapierPhysicsWorld adapter', () => {
  it('reports WASM initialization failure and recovers on a subsequent create', async () => {
    setRapierModuleLoaderForTests(async () => {
      throw new Error('synthetic WASM startup failure');
    });

    try {
      await expect(RapierPhysicsWorld.create()).rejects.toMatchObject({
        code: 'physics.backend-init-failed',
        message: 'Rapier WebAssembly initialization failed',
      });
    } finally {
      setRapierModuleLoaderForTests(null);
    }

    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    expect(physics.step(1 / 60)).toBe(true);
    physics.dispose();
  });

  it('steps dynamic bodies with the supplied fixed delta and supports pause', async () => {
    const physics = await createTestPhysics();
    const entity = new EngineRuntime().world.createEntity();
    const body = physics.createBody(entity, { type: 'dynamic', position: [0, 5, 0] });
    physics.createCollider(body, { shape: { type: 'sphere', radius: 0.5 } });
    const initial = physics.getPose(body).position[1];
    for (let i = 0; i < 60; i++) physics.step(1 / 60);
    const fallen = physics.getPose(body).position[1];
    expect(fallen).toBeLessThan(initial);
    physics.setPaused(true);
    physics.step(1 / 60);
    expect(physics.getPose(body).position[1]).toBeCloseTo(fallen);
    physics.dispose();
    expect(() => physics.getPose(body)).toThrow('disposed');
  });

  it('resolves kinematic capsule movement against a floor and reports grounded state', async () => {
    const physics = await createTestPhysics();
    const world = new EngineRuntime().world;
    const floorEntity = world.createEntity();
    const characterEntity = world.createEntity();
    const floor = physics.createBody(floorEntity, { type: 'static', position: [0, -0.5, 0] });
    physics.createCollider(floor, { shape: { type: 'box', halfExtents: [5, 0.5, 5] } });
    const character = physics.createBody(characterEntity, {
      type: 'kinematic',
      position: [0, 1, 0],
    });
    const capsule = physics.createCollider(character, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const controller = physics.createCharacterController(capsule, {
      offset: 0.01,
      snapToGroundDistance: 0.1,
    });

    physics.step(1 / 60);
    const movement = physics.moveCharacterController(controller, [0, -1, 0]);
    expect(movement.translation[1]).toBeGreaterThan(-1);
    expect(movement.translation[1]).toBeLessThan(0);
    expect(movement.grounded).toBe(true);
    const floorCollision = movement.collisions.find((collision) => collision.entity === floorEntity);
    expect(floorCollision).toBeDefined();
    expect(floorCollision?.normal.every(Number.isFinite)).toBe(true);
    expect(floorCollision?.normal[1]).toBeGreaterThan(0.9);
    physics.step(1 / 60);
    expect(physics.getPose(character).position[1]).toBeLessThan(1);
    physics.removeCharacterController(controller);
    physics.dispose();
  });

  it('climbs a slope below maxSlopeClimbAngle', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const floorEntity = world.createEntity();
    const rampEntity = world.createEntity();
    const characterEntity = world.createEntity();

    const floor = physics.createBody(floorEntity, {
      type: 'static',
      position: [-2, -0.5, 0],
    });
    physics.createCollider(floor, { shape: { type: 'box', halfExtents: [2, 0.5, 3] } });

    const slope = (25 * Math.PI) / 180;
    const ramp = physics.createBody(rampEntity, {
      type: 'static',
      position: [2, 2 * Math.sin(slope) - 0.1 * Math.cos(slope), 0],
      rotation: [0, 0, Math.sin(slope / 2), Math.cos(slope / 2)],
    });
    physics.createCollider(ramp, { shape: { type: 'box', halfExtents: [2, 0.1, 3] } });

    const character = physics.createBody(characterEntity, {
      type: 'kinematic',
      position: [-0.8, 0.75, 0],
    });
    const capsule = physics.createCollider(character, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const controller = physics.createCharacterController(capsule, {
      offset: 0.01,
      maxSlopeClimbAngle: (30 * Math.PI) / 180,
    });

    // Rapier's character query broadphase is valid after the initial world step.
    physics.step(1 / 60);
    const movement = physics.moveCharacterController(controller, [4, 0, 0]);

    expect(movement.translation[0]).toBeGreaterThan(2.5);
    expect(movement.translation[1]).toBeGreaterThan(0.5);
    expect(movement.collisions.some((collision) => collision.entity === rampEntity)).toBe(true);

    physics.removeCharacterController(controller);
    physics.dispose();
  });

  it('blocks a slope above maxSlopeClimbAngle', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const floorEntity = world.createEntity();
    const rampEntity = world.createEntity();
    const characterEntity = world.createEntity();

    const floor = physics.createBody(floorEntity, {
      type: 'static',
      position: [-2, -0.5, 0],
    });
    physics.createCollider(floor, { shape: { type: 'box', halfExtents: [2, 0.5, 3] } });

    const slope = (55 * Math.PI) / 180;
    const ramp = physics.createBody(rampEntity, {
      type: 'static',
      position: [2, 2 * Math.sin(slope) - 0.1 * Math.cos(slope), 0],
      rotation: [0, 0, Math.sin(slope / 2), Math.cos(slope / 2)],
    });
    physics.createCollider(ramp, { shape: { type: 'box', halfExtents: [2, 0.1, 3] } });

    const character = physics.createBody(characterEntity, {
      type: 'kinematic',
      position: [-0.8, 0.75, 0],
    });
    const capsule = physics.createCollider(character, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const controller = physics.createCharacterController(capsule, {
      offset: 0.01,
      maxSlopeClimbAngle: (30 * Math.PI) / 180,
    });

    physics.step(1 / 60);
    const movement = physics.moveCharacterController(controller, [4, 0, 0]);

    expect(movement.translation[0]).toBeLessThan(2.5);
    expect(movement.translation[1]).toBeLessThan(0.2);
    expect(movement.collisions.some((collision) => collision.entity === rampEntity)).toBe(true);

    physics.removeCharacterController(controller);
    physics.dispose();
  });

  it('steps onto an obstacle within the configured autostep height', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const floorEntity = world.createEntity();
    const stepEntity = world.createEntity();
    const characterEntity = world.createEntity();

    const floor = physics.createBody(floorEntity, {
      type: 'static',
      position: [1, -0.5, 0],
    });
    physics.createCollider(floor, { shape: { type: 'box', halfExtents: [4, 0.5, 3] } });

    const step = physics.createBody(stepEntity, {
      type: 'static',
      position: [0.5, 0.2, 0],
    });
    physics.createCollider(step, { shape: { type: 'box', halfExtents: [0.3, 0.2, 1] } });

    const character = physics.createBody(characterEntity, {
      type: 'kinematic',
      position: [-1.5, 0.76, 0],
    });
    const capsule = physics.createCollider(character, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const controller = physics.createCharacterController(capsule, {
      offset: 0.01,
      autostep: { maxHeight: 0.45, minWidth: 0.2 },
    });

    // Refresh Rapier's character query broadphase after creating the scene.
    physics.step(1 / 60);
    const movement = physics.moveCharacterController(controller, [3, 0, 0]);

    expect(movement.translation[0]).toBeGreaterThan(2.2);
    expect(movement.translation[1]).toBeGreaterThan(0.25);
    expect(movement.collisions.some((collision) => collision.entity === stepEntity)).toBe(true);

    physics.removeCharacterController(controller);
    physics.dispose();
  });

  it('does not autostep an obstacle above the configured height', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const floorEntity = world.createEntity();
    const stepEntity = world.createEntity();
    const characterEntity = world.createEntity();

    const floor = physics.createBody(floorEntity, {
      type: 'static',
      position: [1, -0.5, 0],
    });
    physics.createCollider(floor, { shape: { type: 'box', halfExtents: [4, 0.5, 3] } });

    const step = physics.createBody(stepEntity, {
      type: 'static',
      position: [0.5, 0.4, 0],
    });
    physics.createCollider(step, { shape: { type: 'box', halfExtents: [0.3, 0.4, 1] } });

    const character = physics.createBody(characterEntity, {
      type: 'kinematic',
      position: [-1.5, 0.76, 0],
    });
    const capsule = physics.createCollider(character, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const controller = physics.createCharacterController(capsule, {
      offset: 0.01,
      autostep: { maxHeight: 0.45, minWidth: 0.2 },
    });

    physics.step(1 / 60);
    const movement = physics.moveCharacterController(controller, [3, 0, 0]);

    expect(movement.translation[0]).toBeLessThan(2);
    expect(movement.translation[1]).toBeLessThan(0.15);
    expect(movement.collisions.some((collision) => collision.entity === stepEntity)).toBe(true);

    physics.removeCharacterController(controller);
    physics.dispose();
  });

  it('recreates a character controller after collider/body teardown', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const entity = world.createEntity();

    const firstBody = physics.createBody(entity, {
      type: 'kinematic',
      position: [0, 1, 0],
    });
    const firstCollider = physics.createCollider(firstBody, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const firstController = physics.createCharacterController(firstCollider);
    physics.removeBody(firstBody);

    expect(() => physics.moveCharacterController(firstController, [1, 0, 0])).toThrow(
      expect.objectContaining({ code: 'physics.stale-handle' }),
    );

    const secondBody = physics.createBody(entity, {
      type: 'kinematic',
      position: [2, 1, 0],
    });
    const secondCollider = physics.createCollider(secondBody, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const secondController = physics.createCharacterController(secondCollider);
    physics.step(1 / 60);

    const movement = physics.moveCharacterController(secondController, [0.5, 0, 0]);
    expect(movement.translation).toEqual([0.5, 0, 0]);
    expect(() => physics.moveCharacterController(firstController, [0, 0, 1])).toThrow(
      expect.objectContaining({ code: 'physics.stale-handle' }),
    );

    physics.dispose();
  });

  it('reinitializes the Rapier world after disposing a world with a live controller', async () => {
    const firstWorld = await createTestPhysics({ gravity: [0, 0, 0] });
    const firstEntity = new EngineRuntime().world.createEntity();
    const firstBody = firstWorld.createBody(firstEntity, {
      type: 'kinematic',
      position: [0, 1, 0],
    });
    const firstCollider = firstWorld.createCollider(firstBody, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const firstController = firstWorld.createCharacterController(firstCollider);
    firstWorld.dispose();
    expect(() => firstWorld.moveCharacterController(firstController, [1, 0, 0])).toThrow(
      expect.objectContaining({ code: 'physics.disposed' }),
    );

    const secondWorld = await createTestPhysics({ gravity: [0, 0, 0] });
    const secondEntity = new EngineRuntime().world.createEntity();
    const secondBody = secondWorld.createBody(secondEntity, {
      type: 'kinematic',
      position: [0, 1, 0],
    });
    const secondCollider = secondWorld.createCollider(secondBody, {
      shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 },
    });
    const secondController = secondWorld.createCharacterController(secondCollider);
    secondWorld.step(1 / 60);

    expect(secondWorld.moveCharacterController(secondController, [0.25, 0, 0]).translation).toEqual(
      [0.25, 0, 0],
    );
    secondWorld.dispose();
  });

  it('raycasts nearest-first and rejects stale handles', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const near = world.createEntity();
    const far = world.createEntity();
    const nearBody = physics.createBody(near, { type: 'static', position: [0, 0, -2] });
    const farBody = physics.createBody(far, { type: 'static', position: [0, 0, -4] });
    const nearCollider = physics.createCollider(nearBody, {
      shape: { type: 'sphere', radius: 0.5 },
    });
    physics.createCollider(farBody, { shape: { type: 'sphere', radius: 0.5 } });
    physics.step(1 / 60);
    const hits = physics.raycastAll({ origin: [0, 0, 0], direction: [0, 0, -1], maxDistance: 10 });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.entity).toBe(near);
    expect(hits[0]?.collider).toBe(nearCollider);
    expect(
      physics.raycast(
        { origin: [0, 0, 0], direction: [0, 0, -1], maxDistance: 10 },
        { excludeEntities: [near] },
      )?.entity,
    ).toBe(far);
    physics.removeBody(nearBody);
    let staleCode = '';
    try {
      physics.getPose(nearBody);
    } catch (error) {
      staleCode = (error as { code?: string }).code ?? '';
    }
    expect(staleCode).toBe('physics.stale-handle');
    physics.dispose();
  });

  it('queues one fixed tick while paused and validates body operation types', async () => {
    const physics = await createTestPhysics();
    const entity = new EngineRuntime().world.createEntity();
    const body = physics.createBody(entity, { type: 'dynamic', position: [0, 2, 0] });
    physics.createCollider(body, { shape: { type: 'sphere', radius: 0.5 } });
    physics.setPaused(true);
    const before = physics.getPose(body).position[1];
    physics.step(1 / 60);
    expect(physics.getPose(body).position[1]).toBeCloseTo(before);
    physics.requestSingleStep();
    physics.step(1 / 60);
    expect(physics.getPose(body).position[1]).toBeLessThan(before);
    expect(() => physics.requestSingleStep()).not.toThrow();
    expect(() =>
      physics.setStaticPose(body, { position: [0, 0, 0], rotation: [0, 0, 0, 1] }),
    ).toThrow('Static pose update');
    physics.dispose();
  });

  it('enforces configured body, collider, and ray resource limits', async () => {
    const physics = await createTestPhysics({
      limits: { maxBodies: 1, maxColliders: 1, maxRayDistance: 5 },
    });
    const world = new EngineRuntime().world;
    const firstEntity = world.createEntity();
    const secondEntity = world.createEntity();
    const firstBody = physics.createBody(firstEntity, {
      type: 'static',
      position: [0, 0, 0],
    });
    expect(() => physics.createBody(secondEntity, { type: 'static', position: [0, 0, 0] })).toThrow(
      /maxBodies=1/,
    );
    physics.createCollider(firstBody, { shape: { type: 'sphere', radius: 1 } });
    expect(() =>
      physics.createCollider(firstBody, { shape: { type: 'sphere', radius: 1 } }),
    ).toThrow(/maxColliders=1/);
    expect(() =>
      physics.raycast({
        origin: [0, 0, 0],
        direction: [1, 0, 0],
        maxDistance: 5.01,
      }),
    ).toThrow(/Ray maxDistance exceeds configured limit/);
    physics.dispose();
  });

  it('bounds convex-hull vertex input before backend cooking', async () => {
    const physics = await createTestPhysics({
      limits: { maxConvexHullVertices: 4 },
    });
    const entity = new EngineRuntime().world.createEntity();
    const body = physics.createBody(entity, { type: 'static', position: [0, 0, 0] });
    expect(() =>
      physics.createCollider(body, {
        shape: {
          type: 'convex-hull',
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]),
        },
      }),
    ).toThrow(/maxConvexHullVertices=4/);
    physics.dispose();
  });

  it('supports static mesh collision and ray queries', async () => {
    const physics = await createTestPhysics();
    const world = new EngineRuntime().world;
    const floorEntity = world.createEntity();
    const ballEntity = world.createEntity();
    const floor = physics.createBody(floorEntity, { type: 'static', position: [0, 0, 0] });
    const floorCollider = physics.createCollider(floor, {
      shape: {
        type: 'triangle-mesh',
        vertices: new Float32Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
      },
    });
    const ball = physics.createBody(ballEntity, { type: 'dynamic', position: [0, 2, 0] });
    physics.createCollider(ball, { shape: { type: 'sphere', radius: 0.5 } });

    for (let tick = 0; tick < 120; tick++) physics.step(1 / 60);

    const y = physics.getPose(ball).position[1];
    expect(y).toBeGreaterThan(0.35);
    expect(y).toBeLessThan(0.8);
    const hit = physics.raycast({
      origin: [4, 2, 0],
      direction: [0, -1, 0],
      maxDistance: 5,
    });
    expect(hit?.entity).toBe(floorEntity);
    expect(hit?.collider).toBe(floorCollider);
    physics.dispose();
  });

  it('rejects non-static meshes and bounds mesh buffers', async () => {
    const physics = await createTestPhysics({
      limits: { maxTriangleMeshVertices: 3, maxTriangleMeshIndices: 3 },
    });
    const world = new EngineRuntime().world;
    const dynamicEntity = world.createEntity();
    const dynamicBody = physics.createBody(dynamicEntity, {
      type: 'dynamic',
      position: [0, 0, 0],
    });
    const triangleMesh = {
      type: 'triangle-mesh' as const,
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(() => physics.createCollider(dynamicBody, { shape: triangleMesh })).toThrow(
      /Triangle-mesh colliders require a static rigid body/,
    );

    const staticBody = physics.createBody(world.createEntity(), {
      type: 'static',
      position: [0, 0, 0],
    });
    expect(() =>
      physics.createCollider(staticBody, {
        shape: {
          type: 'triangle-mesh',
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
      }),
    ).toThrow(/maxTriangleMeshVertices=3/);
    expect(() =>
      physics.createCollider(staticBody, {
        shape: {
          type: 'triangle-mesh',
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2, 0, 2, 1]),
        },
      }),
    ).toThrow(/maxTriangleMeshIndices=3/);
    expect(() =>
      physics.createCollider(staticBody, {
        shape: {
          type: 'triangle-mesh',
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 3]),
        },
      }),
    ).toThrow(/invalid triangle indices/);
    physics.dispose();
  });

  it('emits stable collision enter and exit events for sensor overlap', async () => {
    const physics = await createTestPhysics({ gravity: [0, 0, 0] });
    const world = new EngineRuntime().world;
    const movingEntity = world.createEntity();
    const fixedEntity = world.createEntity();
    const movingBody = physics.createBody(movingEntity, {
      type: 'dynamic',
      position: [0, 0, 0],
      canSleep: false,
    });
    const fixedBody = physics.createBody(fixedEntity, {
      type: 'static',
      position: [0.75, 0, 0],
    });
    const movingCollider = physics.createCollider(movingBody, {
      shape: { type: 'sphere', radius: 0.5 },
      sensor: true,
    });
    const fixedCollider = physics.createCollider(fixedBody, {
      shape: { type: 'sphere', radius: 0.5 },
      sensor: true,
    });

    physics.step(1 / 60);
    const enter = physics.drainCollisionEvents();
    expect(enter).toHaveLength(1);
    expect(enter[0]).toMatchObject({
      entityA: movingEntity,
      entityB: fixedEntity,
      colliderA: movingCollider,
      colliderB: fixedCollider,
      started: true,
    });

    physics.applyImpulse(movingBody, [100, 0, 0]);
    physics.step(1 / 60);
    // Rapier reports sensor separation on the following pipeline step.
    physics.step(1 / 60);
    const exit = physics.drainCollisionEvents();
    expect(exit).toHaveLength(1);
    expect(exit[0]).toMatchObject({
      entityA: movingEntity,
      entityB: fixedEntity,
      colliderA: movingCollider,
      colliderB: fixedCollider,
      started: false,
    });
    physics.dispose();
  });

  it('reports collision event overflow instead of silently truncating the drain', async () => {
    const physics = await createTestPhysics({
      gravity: [0, 0, 0],
      limits: { maxCollisionEventsPerDrain: 1 },
    });
    const world = new EngineRuntime().world;
    const entities = [world.createEntity(), world.createEntity(), world.createEntity()];
    const bodies = [
      physics.createBody(entities[0]!, { type: 'dynamic', position: [0, 0, 0] }),
      physics.createBody(entities[1]!, { type: 'static', position: [0, 0, 0] }),
      physics.createBody(entities[2]!, { type: 'static', position: [0.5, 0, 0] }),
    ];
    for (const body of bodies)
      physics.createCollider(body, { shape: { type: 'sphere', radius: 1 } });
    physics.step(1 / 60);
    expect(() => physics.drainCollisionEvents()).toThrow(/maxCollisionEventsPerDrain=1/);
    physics.dispose();
  });

  it('rejects invalid resource limit configuration', async () => {
    await expect(createTestPhysics({ limits: { maxBodies: 0 } })).rejects.toMatchObject({
      code: 'physics.invalid-resource-limits',
    });
  });

  it('validates collider dimensions and normalized ray directions', async () => {
    const physics = await createTestPhysics();
    const entity = new EngineRuntime().world.createEntity();
    const body = physics.createBody(entity, { type: 'static', position: [0, 0, 0] });
    expect(() => physics.createCollider(body, { shape: { type: 'sphere', radius: 0 } })).toThrow(
      'positive',
    );
    expect(() =>
      physics.raycast({ origin: [0, 0, 0], direction: [0, 0, -2], maxDistance: 10 }),
    ).toThrow('normalized');
    physics.dispose();
  });
});
