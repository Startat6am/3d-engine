import { describe, expect, it } from 'vitest';
import { EngineRuntime } from '@engine/core';
import type { PhysicsWorld } from '../src/types.js';
import { RapierPhysicsWorld, setRapierModuleLoaderForTests } from '../src/rapier-world.js';
import { FakePhysicsWorld } from './fake-physics-world.js';

async function createRapierWorld(): Promise<PhysicsWorld> {
  setRapierModuleLoaderForTests(async () => {
    const rapier = await import('@dimforge/rapier3d-compat');
    await rapier.init();
    return rapier as unknown as typeof import('@dimforge/rapier3d');
  });
  try {
    return await RapierPhysicsWorld.create({ gravity: [0, 0, 0] });
  } finally {
    setRapierModuleLoaderForTests(null);
  }
}

function registerPhysicsWorldConformance(
  name: string,
  createWorld: () => Promise<PhysicsWorld> | PhysicsWorld,
) {
  describe(`${name} PhysicsWorld conformance`, () => {
    it('creates, reads, updates, and removes body handles', async () => {
      const physics = await createWorld();
      const entity = new EngineRuntime().world.createEntity();
      const body = physics.createBody(entity, { type: 'static', position: [1, 2, 3] });
      expect(physics.getPose(body).position).toEqual([1, 2, 3]);
      physics.setStaticPose(body, { position: [4, 5, 6], rotation: [0, 0, 0, 1] });
      expect(physics.getPose(body).position).toEqual([4, 5, 6]);
      physics.removeBody(body);
      expect(() => physics.getPose(body)).toThrow(
        expect.objectContaining({ code: 'physics.stale-handle' }),
      );
      physics.dispose();
    });

    it('removes child colliders with their body and rejects stale collider handles', async () => {
      const physics = await createWorld();
      const entity = new EngineRuntime().world.createEntity();
      const body = physics.createBody(entity, { type: 'static', position: [0, 0, 0] });
      const collider = physics.createCollider(body, { shape: { type: 'sphere', radius: 0.5 } });
      physics.removeBody(body);
      expect(() => physics.removeCollider(collider)).toThrow(
        expect.objectContaining({ code: 'physics.stale-handle' }),
      );
      physics.dispose();
    });

    it('implements pause and exactly one requested single step', async () => {
      const physics = await createWorld();
      const entity = new EngineRuntime().world.createEntity();
      const body = physics.createBody(entity, { type: 'dynamic', position: [0, 0, 0] });
      physics.setPaused(true);
      expect(physics.step(1 / 60)).toBe(false);
      physics.requestSingleStep();
      expect(physics.step(1 / 60)).toBe(true);
      expect(physics.step(1 / 60)).toBe(false);
      expect(physics.getPose(body).position).toEqual([0, 0, 0]);
      physics.dispose();
    });

    it('raycasts nearest-first, filters groups, and excludes requested entities', async () => {
      const physics = await createWorld();
      const world = new EngineRuntime().world;
      const nearEntity = world.createEntity();
      const farEntity = world.createEntity();
      const filteredEntity = world.createEntity();
      const nearBody = physics.createBody(nearEntity, {
        type: 'static',
        position: [0, 0, -2],
      });
      const farBody = physics.createBody(farEntity, {
        type: 'static',
        position: [0, 0, -4],
      });
      const filteredBody = physics.createBody(filteredEntity, {
        type: 'static',
        position: [0, 0, -6],
      });
      const nearCollider = physics.createCollider(nearBody, {
        shape: { type: 'sphere', radius: 0.5 },
      });
      const farCollider = physics.createCollider(farBody, {
        shape: { type: 'sphere', radius: 0.5 },
      });
      physics.createCollider(filteredBody, {
        shape: { type: 'sphere', radius: 0.5 },
        collisionGroups: 0x00040008,
      });
      const ray = { origin: [0, 0, 0] as const, direction: [0, 0, -1] as const, maxDistance: 10 };
      physics.step(1 / 60);

      const hits = physics.raycastAll(ray, { collisionGroups: 0x00010002 });
      expect(hits.map((hit) => hit.collider)).toEqual([nearCollider, farCollider]);
      expect(physics.raycast(ray, { collisionGroups: 0x00010002 })?.collider).toBe(nearCollider);
      expect(
        physics.raycast(ray, {
          collisionGroups: 0x00010002,
          excludeEntities: [nearEntity],
        })?.collider,
      ).toBe(farCollider);
      expect(physics.raycast(ray, { collisionGroups: 0x00010002 })?.distance).toBeCloseTo(1.5);
      physics.dispose();
    });

    it('emits collision enter and exit events with stable entity/collider identities', async () => {
      const physics = await createWorld();
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
      expect(physics.drainCollisionEvents()).toContainEqual({
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
      expect(physics.drainCollisionEvents()).toContainEqual({
        entityA: movingEntity,
        entityB: fixedEntity,
        colliderA: movingCollider,
        colliderB: fixedCollider,
        started: false,
      });
      physics.dispose();
    });

    it('returns empty query and event collections when the world has no geometry', async () => {
      const physics = await createWorld();
      const ray = { origin: [0, 0, 0] as const, direction: [1, 0, 0] as const, maxDistance: 10 };
      expect(physics.raycast(ray)).toBeNull();
      expect(physics.raycastAll(ray)).toEqual([]);
      expect(physics.drainCollisionEvents()).toEqual([]);
      physics.dispose();
    });

    it('disposes idempotently and rejects subsequent operations', async () => {
      const physics = await createWorld();
      physics.dispose();
      expect(() => physics.dispose()).not.toThrow();
      expect(() => physics.step(1 / 60)).toThrow(
        expect.objectContaining({ code: 'physics.disposed' }),
      );
    });
  });
}

registerPhysicsWorldConformance('Fake', () => new FakePhysicsWorld());
registerPhysicsWorldConformance('Rapier', createRapierWorld);
