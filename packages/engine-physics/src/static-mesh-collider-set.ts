import type { EntityId } from '@engine/core';
import type { PhysicsBodyHandle, PhysicsColliderHandle, PhysicsWorld, Vec3 } from './types.js';

/** A chunk-local triangle mesh and the revision token that produced it. */
export interface StaticMeshColliderInput {
  readonly key: string;
  readonly entity: EntityId;
  readonly revision: string | number;
  readonly position: Vec3;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly friction?: number;
  readonly restitution?: number;
}

interface StaticMeshColliderRecord {
  readonly revision: string | number;
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
}

/**
 * Owns static triangle-mesh bodies for streamed world chunks.
 * Sync replaces changed chunks only after their new collider was created,
 * removes chunks no longer present, and dispose releases every owned handle.
 * The caller must provide a revision token that includes source and neighbor revisions.
 */
export class StaticMeshColliderSet {
  readonly #physics: PhysicsWorld;
  readonly #records = new Map<string, StaticMeshColliderRecord>();
  #disposed = false;

  constructor(physics: PhysicsWorld) {
    this.#physics = physics;
  }

  get size(): number {
    return this.#records.size;
  }

  sync(inputs: readonly StaticMeshColliderInput[]): void {
    this.#assertActive();
    const desired = new Map<string, StaticMeshColliderInput>();
    const seen = new Set<string>();
    for (const input of inputs) {
      if (!input.key.trim() || seen.has(input.key)) {
        throw new Error(`Static mesh collider keys must be non-empty and unique: ${input.key}`);
      }
      seen.add(input.key);
      if (input.vertices.length === 0 || input.indices.length === 0) continue;
      if (input.vertices.length % 3 !== 0 || input.indices.length % 3 !== 0) {
        throw new Error(`Static mesh collider '${input.key}' has invalid triangle geometry`);
      }
      desired.set(input.key, input);
    }
...[truncated]