import type { EntityId } from '@engine/core';
import {
  PhysicsError,
  type ColliderDescriptor,
  type CollisionEvent,
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsPose,
  type PhysicsWorld,
  type Ray,
  type RaycastHit,
  type RaycastOptions,
  type RigidBodyDescriptor,
  type Vec3,
} from '../src/types.js';

interface FakeBody {
  readonly entity: EntityId;
  readonly type: RigidBodyDescriptor['type'];
  pose: PhysicsPose;
  velocity: Vec3;
}

interface FakeCollider {
  readonly body: PhysicsBodyHandle;
  readonly descriptor: ColliderDescriptor;
}

interface FakeCollisionPair {
  readonly colliderA: PhysicsColliderHandle;
  readonly colliderB: PhysicsColliderHandle;
}

/** Deterministic test backend with sphere-only overlap events; it is not a production solver. */
export class FakePhysicsWorld implements PhysicsWorld {
  readonly #bodies = new Map<PhysicsBodyHandle, FakeBody>();
  readonly #colliders = new Map<PhysicsColliderHandle, FakeCollider>();
  readonly #events: CollisionEvent[] = [];
  #activePairs = new Map<string, FakeCollisionPair>();
  #nextHandle = 0;
  #paused = false;
  #singleStep = false;
  #disposed = false;

  get paused(): boolean {
    return this.#paused;
  }

  setPaused(paused: boolean): void {
    this.#assertActive();
    this.#paused = paused;
  }

  requestSingleStep(): void {
    this.#assertActive();
    this.#singleStep = true;
  }

  createBody(entity: EntityId, descriptor: RigidBodyDescriptor): PhysicsBodyHandle {
    this.#assertActive();
    const handle = `fake-body-${++this.#nextHandle}` as PhysicsBodyHandle;
    this.#bodies.set(handle, {
      entity,
      type: descriptor.type,
      pose: {
        position: [...descriptor.position],
        rotation: [...(descriptor.rotation ?? [0, 0, 0, 1])],
      },
      velocity: [0, 0, 0],
    });
    return handle;
  }

  createCollider(body: PhysicsBodyHandle, descriptor: ColliderDescriptor): PhysicsColliderHandle {
    void descriptor;
    this.#body(body);
    const handle = `fake-collider-${++this.#nextHandle}` as PhysicsColliderHandle;
    this.#colliders.set(handle, { body, descriptor });
    return handle;
  }

  removeCollider(handle: PhysicsColliderHandle): void {
    this.#assertActive();
    if (!this.#colliders.delete(handle)) this.#stale('collider');
  }

  removeBody(handle: PhysicsBodyHandle): void {
    this.#assertActive();
    this.#body(handle);
    this.#bodies.delete(handle);
    for (const [collider, record] of this.#colliders) {
      if (record.body === handle) this.#colliders.delete(collider);
    }
  }

  setKinematicTarget(handle: PhysicsBodyHandle, pose: PhysicsPose): void {
    const body = this.#body(handle);
    if (body.type !== 'kinematic')
      throw new PhysicsError(
        'physics.invalid-body-type',
        'Kinematic target requires a kinematic body',
      );
    body.pose = this.#copyPose(pose);
  }

  setStaticPose(handle: PhysicsBodyHandle, pose: PhysicsPose): void {
    const body = this.#body(handle);
    if (body.type !== 'static')
      throw new PhysicsError(
        'physics.invalid-body-type',
        'Static pose update requires a static body',
      );
    body.pose = this.#copyPose(pose);
  }

  getPose(handle: PhysicsBodyHandle): PhysicsPose {
    return this.#copyPose(this.#body(handle).pose);
  }

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vec3, wakeUp = true): void {
    void wakeUp;
    const body = this.#body(handle);
    if (body.type !== 'dynamic')
      throw new PhysicsError('physics.invalid-body-type', 'Impulse requires a dynamic body');
    body.velocity = body.velocity.map((value, index) => value + impulse[index]!) as unknown as Vec3;
  }

  applyForce(handle: PhysicsBodyHandle, force: Vec3, wakeUp = true): void {
    void wakeUp;
    const body = this.#body(handle);
    if (body.type !== 'dynamic')
      throw new PhysicsError('physics.invalid-body-type', 'Force requires a dynamic body');
    body.velocity = body.velocity.map((value, index) => value + force[index]!) as unknown as Vec3;
  }

  step(deltaTime: number): boolean {
    this.#assertActive();
    if (!Number.isFinite(deltaTime) || deltaTime <= 0)
      throw new PhysicsError('physics.invalid-delta', 'Step delta must be finite and positive');
    const shouldStep = !this.#paused || this.#singleStep;
    this.#singleStep = false;
    if (!shouldStep) return false;
    for (const body of this.#bodies.values()) {
      if (body.type !== 'dynamic') continue;
      body.pose = {
        ...body.pose,
        position: body.pose.position.map(
          (value, index) => value + body.velocity[index]! * deltaTime,
        ) as unknown as Vec3,
      };
    }
    this.#updateCollisionEvents();
    return true;
  }

  raycast(ray: Ray, options?: RaycastOptions): RaycastHit | null {
    void ray;
    void options;
    this.#assertActive();
    return null;
  }

  raycastAll(ray: Ray, options?: RaycastOptions): readonly RaycastHit[] {
    void ray;
    void options;
    this.#assertActive();
    return [];
  }

  drainCollisionEvents(): readonly CollisionEvent[] {
    this.#assertActive();
    return this.#events.splice(0);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#bodies.clear();
    this.#colliders.clear();
    this.#activePairs.clear();
    this.#events.length = 0;
  }

  #body(handle: PhysicsBodyHandle): FakeBody {
    this.#assertActive();
    const body = this.#bodies.get(handle);
    if (!body) this.#stale('body');
    return body;
  }

  #updateCollisionEvents(): void {
    const currentPairs = new Map<string, FakeCollisionPair>();
    const colliders = [...this.#colliders.entries()];
    for (let i = 0; i < colliders.length; i++) {
      const [handleA, colliderA] = colliders[i]!;
      const bodyA = this.#bodies.get(colliderA.body);
      const radiusA = this.#sphereRadius(colliderA.descriptor);
      if (!bodyA || radiusA === null) continue;
      for (let j = i + 1; j < colliders.length; j++) {
        const [handleB, colliderB] = colliders[j]!;
        if (colliderA.body === colliderB.body) continue;
        const bodyB = this.#bodies.get(colliderB.body);
        const radiusB = this.#sphereRadius(colliderB.descriptor);
        if (!bodyB || radiusB === null) continue;
        const dx = bodyA.pose.position[0] - bodyB.pose.position[0];
        const dy = bodyA.pose.position[1] - bodyB.pose.position[1];
        const dz = bodyA.pose.position[2] - bodyB.pose.position[2];
        const radius = radiusA + radiusB;
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const key = [handleA, handleB].sort().join('|');
        currentPairs.set(key, { colliderA: handleA, colliderB: handleB });
        if (this.#activePairs.has(key)) continue;
        this.#events.push({
          entityA: bodyA.entity,
          entityB: bodyB.entity,
          colliderA: handleA,
          colliderB: handleB,
          started: true,
        });
      }
    }

    for (const [key, pair] of this.#activePairs) {
      if (currentPairs.has(key)) continue;
      const colliderA = this.#colliders.get(pair.colliderA);
      const colliderB = this.#colliders.get(pair.colliderB);
      const bodyA = colliderA ? this.#bodies.get(colliderA.body) : undefined;
      const bodyB = colliderB ? this.#bodies.get(colliderB.body) : undefined;
      if (!bodyA || !bodyB) continue;
      this.#events.push({
        entityA: bodyA.entity,
        entityB: bodyB.entity,
        colliderA: pair.colliderA,
        colliderB: pair.colliderB,
        started: false,
      });
    }
    this.#activePairs = currentPairs;
  }

  #sphereRadius(descriptor: ColliderDescriptor): number | null {
    return descriptor.shape.type === 'sphere' ? descriptor.shape.radius : null;
  }

  #copyPose(pose: PhysicsPose): PhysicsPose {
    return { position: [...pose.position], rotation: [...pose.rotation] };
  }

  #stale(kind: string): never {
    throw new PhysicsError('physics.stale-handle', `Unknown or stale ${kind} handle`);
  }

  #assertActive(): void {
    if (this.#disposed)
      throw new PhysicsError('physics.disposed', 'Physics world has been disposed');
  }
}
