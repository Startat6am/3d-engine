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

/** Owns static triangle-mesh bodies for streamed world chunks. */
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

    for (const [key, input] of desired) {
      const previous = this.#records.get(key);
      if (previous?.revision === input.revision) continue;

      const body = this.#physics.createBody(input.entity, {
        type: 'static',
        position: input.position,
      });
      let collider: PhysicsColliderHandle;
      try {
        collider = this.#physics.createCollider(body, {
          shape: { type: 'triangle-mesh', vertices: input.vertices, indices: input.indices },
          ...(input.friction === undefined ? {} : { friction: input.friction }),
          ...(input.restitution === undefined ? {} : { restitution: input.restitution }),
        });
      } catch (error) {
        this.#physics.removeBody(body);
        throw error;
      }

      this.#records.set(key, { revision: input.revision, body, collider });
      if (previous) this.#removeRecord(previous);
    }

    for (const [key, record] of this.#records) {
      if (!desired.has(key)) {
        this.#removeRecord(record);
        this.#records.delete(key);
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const record of this.#records.values()) this.#removeRecord(record);
    this.#records.clear();
    this.#disposed = true;
  }

  #removeRecord(record: StaticMeshColliderRecord): void {
    this.#physics.removeCollider(record.collider);
    this.#physics.removeBody(record.body);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('StaticMeshColliderSet has been disposed');
  }
}
