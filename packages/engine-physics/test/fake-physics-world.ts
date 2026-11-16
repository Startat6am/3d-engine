import type { EntityId } from '@engine/core';
import {
  PhysicsError,
  type CharacterControllerMovement,
  type CharacterControllerOptions,
  type ColliderDescriptor,
  type CollisionEvent,
  type PhysicsBodyHandle,
  type PhysicsCharacterControllerHandle,
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
  readonly #characterControllers = new Map<
    PhysicsCharacterControllerHandle,
    PhysicsColliderHandle
  >();
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
    if (!paused) this.#singleStep = false;
  }

  requestSingleStep(): void {
    this.#assertActive();
    if (!this.#paused)
      throw new PhysicsError(
        'physics.not-paused',
        'Single-step is only available while physics is paused',
      );
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

  createCharacterController(
    colliderHandle: PhysicsColliderHandle,
    options: CharacterControllerOptions = {},
  ): PhysicsCharacterControllerHandle {
    this.#assertActive();
    const collider = this.#colliders.get(colliderHandle);
    if (!collider) this.#stale('collider');
    const body = this.#body(collider.body);
    if (
      body.type !== 'kinematic' ||
      collider.descriptor.sensor ||
      collider.descriptor.shape.type !== 'capsule'
    )
      throw new PhysicsError(
        'physics.invalid-character-controller',
        'Character controllers require a non-sensor capsule attached to a kinematic body',
      );
    const offset = options.offset ?? 0.01;
    const up = options.up ?? [0, 1, 0];
    const maxSlope = options.maxSlopeClimbAngle ?? Math.PI / 4;
    const minSlope = options.minSlopeSlideAngle ?? Math.PI / 4;
    if (
      !Number.isFinite(offset) ||
      offset <= 0 ||
      !up.every(Number.isFinite) ||
      Math.abs(Math.hypot(...up) - 1) > 1e-3 ||
      !Number.isFinite(maxSlope) ||
      maxSlope < 0 ||
      maxSlope > Math.PI / 2 ||
      !Number.isFinite(minSlope) ||
      minSlope < 0 ||
      minSlope > Math.PI / 2 ||
      (options.autostep !== undefined &&
        (!Number.isFinite(options.autostep.maxHeight) ||
          options.autostep.maxHeight <= 0 ||
          !Number.isFinite(options.autostep.minWidth) ||
          options.autostep.minWidth <= 0)) ||
      (options.snapToGroundDistance !== undefined &&
        (!Number.isFinite(options.snapToGroundDistance) || options.snapToGroundDistance <= 0))
    )
      throw new PhysicsError(
        'physics.invalid-character-controller',
        'Character controller options are invalid',
      );
    const handle =
      `fake-character-controller-${++this.#nextHandle}` as PhysicsCharacterControllerHandle;
    this.#characterControllers.set(handle, colliderHandle);
    return handle;
  }

  moveCharacterController(
    handle: PhysicsCharacterControllerHandle,
    desiredTranslation: Vec3,
  ): CharacterControllerMovement {
    this.#assertActive();
    const colliderHandle = this.#characterControllers.get(handle);
    if (!colliderHandle) this.#stale('character controller');
    if (!desiredTranslation.every(Number.isFinite))
      throw new PhysicsError(
        'physics.invalid-character-controller',
        'Character movement must be finite',
      );
    const collider = this.#colliders.get(colliderHandle);
    if (!collider) this.#stale('collider');
    const body = this.#body(collider.body);
    if (body.type !== 'kinematic') this.#stale('character controller body');
    body.pose = {
      ...body.pose,
      position: body.pose.position.map(
        (value, index) => value + desiredTranslation[index]!,
      ) as unknown as Vec3,
    };
    return {
      translation: [...desiredTranslation] as unknown as Vec3,
      grounded: false,
      collisions: [],
    };
  }

  removeCharacterController(handle: PhysicsCharacterControllerHandle): void {
    this.#assertActive();
    if (!this.#characterControllers.delete(handle)) this.#stale('character controller');
  }

  removeCollider(handle: PhysicsColliderHandle): void {
    this.#assertActive();
    if (!this.#colliders.has(handle)) this.#stale('collider');
    this.#queueCollisionExits(handle);
    for (const [controller, collider] of this.#characterControllers) {
      if (collider === handle) this.#characterControllers.delete(controller);
    }
    this.#colliders.delete(handle);
  }

  removeBody(handle: PhysicsBodyHandle): void {
    this.#assertActive();
    this.#body(handle);
    for (const [collider, record] of this.#colliders) {
      if (record.body === handle) {
        for (const [controller, controlledCollider] of this.#characterControllers) {
          if (controlledCollider === collider) this.#characterControllers.delete(controller);
        }
        this.#queueCollisionExits(collider);
        this.#colliders.delete(collider);
      }
    }
    this.#bodies.delete(handle);
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
    return this.raycastAll(ray, options)[0] ?? null;
  }

  raycastAll(ray: Ray, options?: RaycastOptions): readonly RaycastHit[] {
    this.#assertActive();
    const directionLength = Math.hypot(...ray.direction);
    if (
      !ray.origin.every(Number.isFinite) ||
      !ray.direction.every(Number.isFinite) ||
      Math.abs(directionLength - 1) > 1e-3 ||
      !Number.isFinite(ray.maxDistance) ||
      ray.maxDistance < 0
    )
      throw new PhysicsError(
        'physics.query-invalid',
        'Ray must have finite values, normalized direction, and non-negative distance',
      );
    const queryGroups = options?.collisionGroups ?? 0xffffffff;
    if (!Number.isInteger(queryGroups) || queryGroups < 0 || queryGroups > 0xffffffff)
      throw new PhysicsError(
        'physics.query-invalid',
        'Query collision groups must be an unsigned 32-bit integer',
      );
    const excluded = new Set(options?.excludeEntities ?? []);
    const hits: RaycastHit[] = [];
    for (const [colliderHandle, collider] of this.#colliders) {
      const body = this.#bodies.get(collider.body);
      const radius = this.#sphereRadius(collider.descriptor);
      if (!body || radius === null || excluded.has(body.entity)) continue;
      if (!this.#groupsInteract(queryGroups, collider.descriptor.collisionGroups ?? 0xffffffff))
        continue;
      const offset = [
        ray.origin[0] - body.pose.position[0],
        ray.origin[1] - body.pose.position[1],
        ray.origin[2] - body.pose.position[2],
      ] as const;
      const projected = -(
        offset[0] * ray.direction[0] +
        offset[1] * ray.direction[1] +
        offset[2] * ray.direction[2]
      );
      const perpendicularSquared =
        offset[0] * offset[0] +
        offset[1] * offset[1] +
        offset[2] * offset[2] -
        projected * projected;
      const radiusSquared = radius * radius;
      if (perpendicularSquared > radiusSquared) continue;
      const halfChord = Math.sqrt(radiusSquared - perpendicularSquared);
      const entryDistance = projected - halfChord;
      const exitDistance = projected + halfChord;
      const distance =
        entryDistance >= 0 ? entryDistance : options?.solid === false ? exitDistance : 0;
      if (distance < 0 || distance > ray.maxDistance) continue;
      const point = [
        ray.origin[0] + ray.direction[0] * distance,
        ray.origin[1] + ray.direction[1] * distance,
        ray.origin[2] + ray.direction[2] * distance,
      ] as const;
      const normalVector = [
        point[0] - body.pose.position[0],
        point[1] - body.pose.position[1],
        point[2] - body.pose.position[2],
      ] as const;
      const normalLength = Math.hypot(...normalVector) || 1;
      hits.push({
        entity: body.entity,
        collider: colliderHandle,
        point,
        normal: normalVector.map((value) => value / normalLength) as unknown as Vec3,
        distance,
      });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  #groupsInteract(groupsA: number, groupsB: number): boolean {
    const membershipA = (groupsA >>> 16) & 0xffff;
    const filterA = groupsA & 0xffff;
    const membershipB = (groupsB >>> 16) & 0xffff;
    const filterB = groupsB & 0xffff;
    return (membershipA & filterB) !== 0 && (membershipB & filterA) !== 0;
  }

  drainCollisionEvents(): readonly CollisionEvent[] {
    this.#assertActive();
    return this.#events.splice(0);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#characterControllers.clear();
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
        if (
          !this.#groupsInteract(
            colliderA.descriptor.collisionGroups ?? 0xffffffff,
            colliderB.descriptor.collisionGroups ?? 0xffffffff,
          )
        )
          continue;
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

  #queueCollisionExits(handle: PhysicsColliderHandle): void {
    for (const [key, pair] of this.#activePairs) {
      if (pair.colliderA !== handle && pair.colliderB !== handle) continue;
      const colliderA = this.#colliders.get(pair.colliderA);
      const colliderB = this.#colliders.get(pair.colliderB);
      const bodyA = colliderA ? this.#bodies.get(colliderA.body) : undefined;
      const bodyB = colliderB ? this.#bodies.get(colliderB.body) : undefined;
      if (bodyA && bodyB) {
        this.#events.push({
          entityA: bodyA.entity,
          entityB: bodyB.entity,
          colliderA: pair.colliderA,
          colliderB: pair.colliderB,
          started: false,
        });
      }
      this.#activePairs.delete(key);
    }
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
