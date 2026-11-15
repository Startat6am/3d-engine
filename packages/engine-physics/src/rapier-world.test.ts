import { describe, expect, it } from 'vitest';
import { EngineRuntime } from '@engine/core';
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

describe('RapierPhysicsWorld adapter', () => {
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
