import { describe, expect, it, vi } from 'vitest';
import { EngineRuntime, type EntityId } from '@engine/core';
import type { PhysicsBodyHandle, PhysicsColliderHandle, PhysicsWorld } from './types.js';
import { RapierPhysicsWorld, setRapierModuleLoaderForTests } from './rapier-world.js';
import { StaticMeshColliderSet, type StaticMeshColliderInput } from './static-mesh-collider-set.js';

function createHarness() {
  let next = 0;
  const calls: string[] = [];
  const physics = {
    createBody: vi.fn(() => {
      const handle = `body-${++next}` as PhysicsBodyHandle;
      calls.push(`create-body:${handle}`);
      return handle;
    }),
    createCollider: vi.fn(() => {
      const handle = `collider-${++next}` as PhysicsColliderHandle;
      calls.push(`create-collider:${handle}`);
      return handle;
    }),
    removeCollider: vi.fn((handle: PhysicsColliderHandle) =>
      calls.push(`remove-collider:${handle}`),
    ),
    removeBody: vi.fn((handle: PhysicsBodyHandle) => calls.push(`remove-body:${handle})),
  } as unknown as PhysicsWorld;
  return { physics, calls };
}

function input(key: string, revision: number): StaticMeshColliderInput {
  return {
    key,
    entity: `voxel:${key}` as EntityId,
    revision,
    position: [0, 0, 0],
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

describe('StaticMeshColliderSet', () => {
  it('creates chunk colliders, skips unchanged revisions, and removes unloaded chunks', () => {
    const { physics, calls } = createHarness();
    const set = new StaticMeshColliderSet(physics);
    set.sync([input('0,0,0', 1), input('1,0,0', 1)]);
    expect(set.size).toBe(2);
    expect(physics.createBody).toHaveBeenCalledTimes(2);
    set.sync([input('0,0,0', 1), input('1,0,0', 1)]);
    expect(physics.createBody).toHaveBeenCalledTimes(2);
    set.sync([input('0,0,0', 1)]);
    expect(set.size).toBe(1);
    expect(calls).toContain('remove-collider:collider-4');
    expect(calls).toContain('remove-body:body-3');
  });

  it('creates a replacement before releasing the previous chunk collider', () => {
    const { physics, calls } = createHarness();
    const set = new StaticMeshColliderSet(physics);
    set.sync([input('0,0,0', 1)]);
    set.sync([input('0,0,0', 2)]);
    expect(calls.indexOf('create-collider:collider-4')).toBeLessThan(
      calls.indexOf('remove-collider:collider-2'),
    );
    expect(set.size).toBe(1);
  });

  it('releases a newly-created body if collider creation fails and retains the old collider', () => {
    const { physics, calls } = createHarness();
    const set = new StaticMeshColliderSet(physics);
    set.sync([input('0,0,0', 1)]);
    vi.mocked(physics.createCollider).mockImplementationOnce(() => {
      throw new Error('collider allocation failed');
    });
    expect(() => set.sync([input('0,0,0', 2)])).toThrow('collider allocation failed');
    expect(set.size).toBe(1);
    expect(calls).toContain('remove-body:body-3');
    expect(calls).not.toContain('remove-collider:collider-2');
  });

  it('disposes all handles once and rejects later sync calls', () => {
    const { physics } = createHarness();
    const set = new StaticMeshColliderSet(physics);
    set.sync([input('0,0,0', 1)]);
    set.dispose();
    set.dispose();
    expect(set.size).toBe(0);
    expect(physics.removeCollider).toHaveBeenCalledTimes(1);
    expect(physics.removeBody).toHaveBeenCalledTimes(1);
    expect(() => set.sync([])).toThrow('disposed');
  });
});

async function createRapierPhysics(): Promise<RapierPhysicsWorld> {
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

describe('StaticMeshColliderSet with Rapier', () => {
  it('registers a triangle mesh for raycasts and removes it when its chunk unloads', async () => {
    const physics = await createRapierPhysics();
    const set = new StaticMeshColliderSet(physics);
    const entity = new EngineRuntime().world.createEntity();
    set.sync([
      {
        key: '0,0,0',
        entity,
        revision: 1,
        position: [0, 0, 0],
        vertices: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]),
        indices: new Uint32Array([0, 2, 1]),
      },
    ]);
    physics.step(1 / 60);
    expect(
      physics.raycast({ origin: [0, 2, 0], direction: [0, -1, 0], maxDistance: 5 })?.entity,
    ).toBe(entity);
    set.sync([]);
    physics.step(1 / 60);
    expect(
      physics.raycast({ origin: [0, 2, 0], direction: [0, -1, 0], maxDistance: 5 }),
    ).toBeNull();
    set.dispose();
    physics.dispose();
  });
});
