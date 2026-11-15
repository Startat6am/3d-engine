import { describe, expect, it } from 'vitest';
import { EngineRuntime, Transform, createTransform } from '@engine/core';
import {
  PhysicsCollider,
  PhysicsPreUpdateSystem,
  PhysicsSystem,
  RigidBody,
} from './physics-system.js';
import { RapierPhysicsWorld, setRapierModuleLoaderForTests } from './rapier-world.js';

async function createTestPhysics(
  options: { readonly gravity?: readonly [number, number, number] } = {},
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

describe('PhysicsSystem ECS integration', () => {
  it('creates backend bodies from ECS and synchronizes dynamic poses before transform propagation', async () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
    const floor = runtime.world.createEntity();
    const ball = runtime.world.createEntity();
    runtime.world.add(floor, Transform, createTransform());
    runtime.world.add(floor, RigidBody, { type: 'static', position: [0, 0, 0] });
    runtime.world.add(floor, PhysicsCollider, { shape: { type: 'box', halfExtents: [5, 0.5, 5] } });
    runtime.world.add(ball, Transform, { ...createTransform(), position: [0, 4, 0] });
    runtime.world.add(ball, RigidBody, { type: 'dynamic', position: [0, 4, 0] });
    runtime.world.add(ball, PhysicsCollider, { shape: { type: 'sphere', radius: 0.5 } });
    const physics = await createTestPhysics();
    const system = new PhysicsSystem(physics);
    runtime.scheduler.add(new PhysicsPreUpdateSystem(system));
    runtime.scheduler.add(system);
    for (let i = 0; i < 30; i++) runtime.advance(1 / 60);
    expect(runtime.world.get(ball, Transform)!.position[1]).toBeLessThan(4);
    expect(runtime.hierarchy.getWorldMatrix(ball)![13]).toBeCloseTo(
      runtime.world.get(ball, Transform)!.position[1],
    );
    system.dispose();
    physics.dispose();
  });

  it('creates entity handles before gameplay fixed-update systems apply impulses', async () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
    const entity = runtime.world.createEntity();
    runtime.world.add(entity, Transform, { ...createTransform(), position: [0, 2, 0] });
    runtime.world.add(entity, RigidBody, { type: 'dynamic', position: [0, 2, 0] });
    runtime.world.add(entity, PhysicsCollider, { shape: { type: 'sphere', radius: 0.5 } });
    const physics = await createTestPhysics();
    const system = new PhysicsSystem(physics);
    runtime.scheduler.add(new PhysicsPreUpdateSystem(system));
    runtime.scheduler.add({
      phase: 'fixed-update',
      update: () => {
        const handle = system.getBodyHandle(entity);
        expect(handle).not.toBeNull();
        physics.applyImpulse(handle!, [0, 1, 0]);
      },
    });
    runtime.scheduler.add(system);
    runtime.advance(1 / 60);
    expect(runtime.world.get(entity, Transform)!.position[1]).toBeGreaterThan(2);
    system.dispose();
    physics.dispose();
  });

  it('publishes collision enter events with stable entity identities', async () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
    const floor = runtime.world.createEntity();
    const ball = runtime.world.createEntity();
    runtime.world.add(floor, Transform, createTransform());
    runtime.world.add(floor, RigidBody, { type: 'static', position: [0, 0, 0] });
    runtime.world.add(floor, PhysicsCollider, { shape: { type: 'box', halfExtents: [2, 0.5, 2] } });
    runtime.world.add(ball, Transform, { ...createTransform(), position: [0, 1.2, 0] });
    runtime.world.add(ball, RigidBody, { type: 'dynamic', position: [0, 1.2, 0] });
    runtime.world.add(ball, PhysicsCollider, { shape: { type: 'sphere', radius: 0.5 } });
    const physics = await createTestPhysics();
    const system = new PhysicsSystem(physics);
    runtime.scheduler.add(new PhysicsPreUpdateSystem(system));
    runtime.scheduler.add(system);
    for (let i = 0; i < 60; i++) runtime.advance(1 / 60);
    const events = system.drainCollisionEvents();
    expect(
      events.some(
        (event) =>
          event.started &&
          new Set([event.entityA, event.entityB]).has(floor) &&
          new Set([event.entityA, event.entityB]).has(ball),
      ),
    ).toBe(true);
    system.dispose();
    physics.dispose();
  });

  it('synchronizes a queued single-step while the simulation is paused', async () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
    const entity = runtime.world.createEntity();
    runtime.world.add(entity, Transform, { ...createTransform(), position: [0, 2, 0] });
    runtime.world.add(entity, RigidBody, { type: 'dynamic', position: [0, 2, 0] });
    runtime.world.add(entity, PhysicsCollider, { shape: { type: 'sphere', radius: 0.5 } });
    const physics = await createTestPhysics();
    const system = new PhysicsSystem(physics);
    runtime.scheduler.add(new PhysicsPreUpdateSystem(system));
    runtime.scheduler.add(system);
    physics.setPaused(true);
    runtime.advance(1 / 60); // body creation, no simulation step
    const before = runtime.world.get(entity, Transform)!.position[1];
    physics.requestSingleStep();
    runtime.advance(1 / 60);
    expect(runtime.world.get(entity, Transform)!.position[1]).toBeLessThan(before);
    system.dispose();
    physics.dispose();
  });

  it('rejects parented and non-unit-scale rigid bodies before stepping', async () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
    const parent = runtime.world.createEntity();
    const child = runtime.world.createEntity();
    runtime.world.add(parent, Transform, createTransform());
    runtime.world.add(child, Transform, { ...createTransform(), parent });
    runtime.world.add(child, RigidBody, { type: 'dynamic', position: [0, 0, 0] });
    const physics = await createTestPhysics();
    const system = new PhysicsSystem(physics);
    runtime.scheduler.add(new PhysicsPreUpdateSystem(system));
    runtime.scheduler.add(system);
    expect(() => runtime.advance(1 / 60)).toThrow('root entity');
    system.dispose();
    physics.dispose();
  });

  it('releases backend resources when ECS entities are destroyed', async () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 1 / 60 });
    const entity = runtime.world.createEntity();
    runtime.world.add(entity, Transform, createTransform());
    runtime.world.add(entity, RigidBody, { type: 'static', position: [0, 0, 0] });
    runtime.world.add(entity, PhysicsCollider, { shape: { type: 'sphere', radius: 1 } });
    const physics = await createTestPhysics();
    const system = new PhysicsSystem(physics);
    runtime.scheduler.add(new PhysicsPreUpdateSystem(system));
    runtime.scheduler.add(system);
    runtime.advance(1 / 60);
    runtime.world.destroyEntity(entity);
    runtime.advance(1 / 60);
    system.dispose();
    physics.dispose();
  });
});
