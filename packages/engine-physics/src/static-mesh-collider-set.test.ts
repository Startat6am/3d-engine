import { describe, expect, it, vi } from 'vitest';
import type { EntityId } from '@engine/core';
import type { PhysicsBodyHandle, PhysicsColliderHandle, PhysicsWorld } from './types.js';
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
    removeBody: vi.fn((handle: PhysicsBodyHandle) => calls.push(`remove-body:${handle}`)),
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

  it('creates a replacement before releasing the pre...[truncated]