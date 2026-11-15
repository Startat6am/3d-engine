import {
  Transform,
  defineComponent,
  type EntityId,
  type SystemContext,
  type TransformData,
  type WorldSystem,
} from '@engine/core';
import {
  PhysicsError,
  type ColliderDescriptor,
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsPose,
  type RigidBodyDescriptor,
  type CollisionEvent,
  type PhysicsWorld,
} from './types.js';

export const RigidBody = defineComponent<RigidBodyDescriptor>('RigidBody');
export const PhysicsCollider = defineComponent<ColliderDescriptor>('PhysicsCollider');

interface PreparedEntity {
  readonly entity: EntityId;
  readonly transform: TransformData;
  readonly descriptor: RigidBodyDescriptor;
  readonly collider?: ColliderDescriptor;
}

interface RuntimeBody {
  readonly handle: PhysicsBodyHandle;
  readonly descriptor: RigidBodyDescriptor;
  colliderHandle: PhysicsColliderHandle | null;
  colliderDescriptor: ColliderDescriptor | null;
}

function assertPhysicsTransform(entity: EntityId, value: TransformData): void {
  if (value.parent !== null)
    throw new PhysicsError(
      'physics.unsupported-transform',
      `Rigid body entity must be a root entity: ${entity}`,
    );
  if (value.scale.length !== 3 || value.scale.some((component) => Math.abs(component - 1) > 1e-6))
    throw new PhysicsError(
      'physics.unsupported-transform',
      `Rigid body entity must use unit scale: ${entity}`,
    );
  if (
    value.position.length !== 3 ||
    value.rotation.length !== 4 ||
    ![...value.position, ...value.rotation].every(Number.isFinite)
  )
    throw new PhysicsError(
      'physics.unsupported-transform',
      `Rigid body transform contains invalid values: ${entity}`,
    );
}

/** Synchronizes ECS rigid-body components with the backend on each existing fixed tick. */
export class PhysicsSystem implements WorldSystem {
  readonly phase = 'fixed-update' as const;
  readonly #runtimeBodies = new Map<EntityId, RuntimeBody>();
  #disposed = false;
  readonly #collisionEvents: CollisionEvent[] = [];
  #preparedEntities: PreparedEntity[] = [];

  constructor(readonly physics: PhysicsWorld) {}

  getBodyHandle(entity: EntityId): PhysicsBodyHandle | null {
    return this.#runtimeBodies.get(entity)?.handle ?? null;
  }

  getColliderHandle(entity: EntityId): PhysicsColliderHandle | null {
    return this.#runtimeBodies.get(entity)?.colliderHandle ?? null;
  }

  /** Ensures ECS bodies/colliders exist before gameplay fixed-update systems run. */
  prepare(context: SystemContext): void {
    if (this.#disposed)
      throw new PhysicsError('physics.disposed', 'Physics system has been disposed');
    const entities: PreparedEntity[] = [];
    context.world.query(Transform, RigidBody).forEach((entity, transform, descriptor) => {
      const collider = context.world.get(entity, PhysicsCollider);
      const typedTransform = transform as TransformData;
      assertPhysicsTransform(entity, typedTransform);
      entities.push({
        entity,
        transform: typedTransform,
        descriptor: descriptor as RigidBodyDescriptor,
        ...(collider ? { collider } : {}),
      });
    });

    const active = new Set(entities.map((item) => item.entity));
    for (const item of entities) {
      let runtime = this.#runtimeBodies.get(item.entity);
      if (runtime && runtime.descriptor !== item.descriptor) {
        this.physics.removeBody(runtime.handle);
        this.#runtimeBodies.delete(item.entity);
        runtime = undefined;
      }
      if (!runtime) {
        const handle = this.physics.createBody(item.entity, {
          ...item.descriptor,
          position: item.transform.position,
          rotation: item.transform.rotation,
        });
        runtime = {
          handle,
          descriptor: item.descriptor,
          colliderHandle: null,
          colliderDescriptor: null,
        };
        this.#runtimeBodies.set(item.entity, runtime);
      }
      const colliderDescriptor = item.collider ?? null;
      if (runtime.colliderDescriptor !== colliderDescriptor) {
        if (runtime.colliderHandle) this.physics.removeCollider(runtime.colliderHandle);
        runtime.colliderHandle = null;
        runtime.colliderDescriptor = colliderDescriptor;
        if (colliderDescriptor)
          runtime.colliderHandle = this.physics.createCollider(runtime.handle, colliderDescriptor);
      }
    }

    for (const [entity, runtime] of this.#runtimeBodies) {
      if (active.has(entity)) continue;
      this.physics.removeBody(runtime.handle);
      this.#runtimeBodies.delete(entity);
    }
    this.#preparedEntities = entities;
  }

  update(context: SystemContext): void {
    if (this.#disposed)
      throw new PhysicsError('physics.disposed', 'Physics system has been disposed');
    // Refresh after gameplay systems too, so newly created entities and authored poses
    // are visible to this tick. The pre-update companion creates handles before gameplay.
    this.prepare(context);
    for (const item of this.#preparedEntities) {
      const runtime = this.#runtimeBodies.get(item.entity);
      if (!runtime) continue;
      const pose: PhysicsPose = {
        position: item.transform.position,
        rotation: item.transform.rotation,
      };
      if (item.descriptor.type === 'static') this.physics.setStaticPose(runtime.handle, pose);
      else if (item.descriptor.type === 'kinematic')
        this.physics.setKinematicTarget(runtime.handle, pose);
    }

    const stepped = this.physics.step(context.deltaTime);
    this.#collisionEvents.push(...this.physics.drainCollisionEvents());
    if (stepped) {
      for (const item of this.#preparedEntities) {
        if (item.descriptor.type !== 'dynamic') continue;
        const runtime = this.#runtimeBodies.get(item.entity);
        if (!runtime || !context.world.isAlive(item.entity)) continue;
        const pose = this.physics.getPose(runtime.handle);
        item.transform.position = pose.position;
        item.transform.rotation = pose.rotation;
      }
    }
  }

  /** Returns and clears collision events generated by the latest fixed ticks. */
  drainCollisionEvents(): readonly CollisionEvent[] {
    return this.#collisionEvents.splice(0);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const runtime of this.#runtimeBodies.values()) this.physics.removeBody(runtime.handle);
    this.#runtimeBodies.clear();
    this.#preparedEntities = [];
    this.#collisionEvents.length = 0;
  }
}

/** Prepares handles before fixed-update gameplay systems need to apply forces. */
export class PhysicsPreUpdateSystem implements WorldSystem {
  readonly phase = 'pre-update' as const;
  constructor(readonly physicsSystem: PhysicsSystem) {}
  update(context: SystemContext): void {
    this.physicsSystem.prepare(context);
  }
}
