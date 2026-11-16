import type { EntityId } from '@engine/core';
import type * as Rapier from '@dimforge/rapier3d';
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
  type PhysicsResourceLimits,
  type PhysicsWorld,
  type Ray,
  type RaycastHit,
  type RaycastOptions,
  type RigidBodyDescriptor,
  type Vec3,
  DEFAULT_PHYSICS_RESOURCE_LIMITS,
} from './types.js';

type RapierModule = typeof import('@dimforge/rapier3d');
type RapierModuleLoader = () => Promise<RapierModule>;
const defaultRapierLoader: RapierModuleLoader = async () =>
  (await import('@dimforge/rapier3d/rapier.js')) as RapierModule;
let rapierLoader: RapierModuleLoader = defaultRapierLoader;

/** Test seam intentionally omitted from the package root exports. */
export function setRapierModuleLoaderForTests(loader: RapierModuleLoader | null): void {
  rapierLoader = loader ?? defaultRapierLoader;
}

interface BodyRecord {
  readonly entity: EntityId;
  readonly type: RigidBodyDescriptor['type'];
  readonly body: Rapier.RigidBody;
}
interface CharacterControllerRecord {
  readonly collider: PhysicsColliderHandle;
  readonly controller: Rapier.KinematicCharacterController;
}
interface ColliderRecord {
  readonly entity: EntityId;
  readonly body: PhysicsBodyHandle;
  readonly collider: Rapier.Collider;
}

/** Rapier 3D implementation. All Rapier objects stay private to this adapter. */
export class RapierPhysicsWorld implements PhysicsWorld {
  readonly #rapier: RapierModule;
  readonly #world: Rapier.World;
  readonly #events: Rapier.EventQueue;
  readonly #bodies = new Map<PhysicsBodyHandle, BodyRecord>();
  readonly #bodyByEntity = new Map<EntityId, PhysicsBodyHandle>();
  readonly #colliders = new Map<PhysicsColliderHandle, ColliderRecord>();
  readonly #characterControllers = new Map<
    PhysicsCharacterControllerHandle,
    CharacterControllerRecord
  >();
  readonly #colliderByRapierHandle = new Map<number, PhysicsColliderHandle>();
  readonly #queuedCollisionEvents: CollisionEvent[] = [];
  readonly #activeCollisionPairs = new Map<string, CollisionEvent>();
  #nextBody = 1;
  #nextCollider = 1;
  #nextCharacterController = 1;
  #paused = false;
  #singleStepRequested = false;
  #disposed = false;
  readonly #limits: PhysicsResourceLimits;

  private constructor(
    rapier: RapierModule,
    gravity: Vec3,
    limits: Partial<PhysicsResourceLimits> = {},
  ) {
    this.#rapier = rapier;
    this.#limits = { ...DEFAULT_PHYSICS_RESOURCE_LIMITS, ...limits };
    this.#validateLimits(this.#limits);
    this.#world = new rapier.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    this.#events = new rapier.EventQueue(true);
  }

  static async create(
    options: { readonly gravity?: Vec3; readonly limits?: Partial<PhysicsResourceLimits> } = {},
  ): Promise<RapierPhysicsWorld> {
    let rapier: RapierModule;
    try {
      rapier = await rapierLoader();
    } catch (cause) {
      throw new PhysicsError(
        'physics.backend-init-failed',
        'Rapier WebAssembly initialization failed',
        { cause },
      );
    }
    return new RapierPhysicsWorld(rapier, options.gravity ?? [0, -9.81, 0], options.limits);
  }

  get paused(): boolean {
    return this.#paused;
  }
  setPaused(paused: boolean): void {
    this.#assertActive();
    this.#paused = paused;
    if (!paused) this.#singleStepRequested = false;
  }

  /** Queues exactly one simulation tick, consumed by the next fixed-update call to step. */
  requestSingleStep(): void {
    this.#assertActive();
    if (!this.#paused)
      throw new PhysicsError(
        'physics.not-paused',
        'Single-step is only available while physics is paused',
      );
    this.#singleStepRequested = true;
  }

  createBody(entity: EntityId, descriptor: RigidBodyDescriptor): PhysicsBodyHandle {
    this.#assertActive();
    this.#validateBody(descriptor);
    if (this.#bodies.size >= this.#limits.maxBodies)
      throw new PhysicsError(
        'physics.resource-limit',
        `Rigid body limit exceeded (maxBodies=${this.#limits.maxBodies})`,
      );
    if (this.#bodyByEntity.has(entity))
      throw new PhysicsError(
        'physics.duplicate-body',
        `Entity already has a rigid body: ${entity}`,
      );
    const rotation = descriptor.rotation ?? [0, 0, 0, 1];
    let bodyDescriptor: Rapier.RigidBodyDesc;
    switch (descriptor.type) {
      case 'static':
        bodyDescriptor = this.#rapier.RigidBodyDesc.fixed();
        break;
      case 'dynamic':
        bodyDescriptor = this.#rapier.RigidBodyDesc.dynamic();
        break;
      case 'kinematic':
        bodyDescriptor = this.#rapier.RigidBodyDesc.kinematicPositionBased();
        break;
      default:
        throw new PhysicsError(
          'physics.invalid-body-descriptor',
          `Unsupported rigid body type: ${String(descriptor.type)}`,
        );
    }
    bodyDescriptor.setTranslation(...descriptor.position);
    bodyDescriptor.setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] });
    if (descriptor.gravityScale !== undefined)
      bodyDescriptor.setGravityScale(descriptor.gravityScale);
    if (descriptor.linearDamping !== undefined)
      bodyDescriptor.setLinearDamping(descriptor.linearDamping);
    if (descriptor.angularDamping !== undefined)
      bodyDescriptor.setAngularDamping(descriptor.angularDamping);
    if (descriptor.canSleep === false) bodyDescriptor.setCanSleep(false);
    const body = this.#world.createRigidBody(bodyDescriptor);
    const handle = `body:${this.#nextBody++}` as PhysicsBodyHandle;
    this.#bodies.set(handle, { entity, type: descriptor.type, body });
    this.#bodyByEntity.set(entity, handle);
    return handle;
  }

  createCollider(
    bodyHandle: PhysicsBodyHandle,
    descriptor: ColliderDescriptor,
  ): PhysicsColliderHandle {
    this.#assertActive();
    const body = this.#body(bodyHandle);
    if (this.#colliders.size >= this.#limits.maxColliders)
      throw new PhysicsError(
        'physics.resource-limit',
        `Collider limit exceeded (maxColliders=${this.#limits.maxColliders})`,
      );
    if (descriptor.shape.type === 'triangle-mesh' && body.type !== 'static')
      throw new PhysicsError(
        'physics.invalid-collider-descriptor',
        'Triangle-mesh colliders require a static rigid body',
      );
    const colliderDescriptor = this.#colliderDescriptor(descriptor);
    const collider = this.#world.createCollider(colliderDescriptor, body.body);
    const handle = `collider:${this.#nextCollider++}` as PhysicsColliderHandle;
    this.#colliders.set(handle, { entity: body.entity, body: bodyHandle, collider });
    this.#colliderByRapierHandle.set(collider.handle, handle);
    return handle;
  }

  createCharacterController(
    colliderHandle: PhysicsColliderHandle,
    options: CharacterControllerOptions = {},
  ): PhysicsCharacterControllerHandle {
    this.#assertActive();
    const collider = this.#collider(colliderHandle);
    const body = this.#body(collider.body);
    if (
      body.type !== 'kinematic' ||
      collider.collider.isSensor() ||
      collider.collider.shapeType() !== this.#rapier.ShapeType.Capsule
    )
      throw new PhysicsError(
        'physics.invalid-character-controller',
        'Character controllers require a non-sensor capsule attached to a kinematic body',
      );
    const offset = options.offset ?? 0.01;
    const up = options.up ?? [0, 1, 0];
    const upLength = Math.hypot(...up);
    const maxSlope = options.maxSlopeClimbAngle ?? Math.PI / 4;
    const minSlope = options.minSlopeSlideAngle ?? Math.PI / 4;
    if (
      !Number.isFinite(offset) ||
      offset <= 0 ||
      !up.every(Number.isFinite) ||
      Math.abs(upLength - 1) > 1e-3 ||
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
    const controller = this.#world.createCharacterController(offset);
    controller.setUp({ x: up[0], y: up[1], z: up[2] });
    controller.setMaxSlopeClimbAngle(maxSlope);
    controller.setMinSlopeSlideAngle(minSlope);
    if (options.autostep)
      controller.enableAutostep(options.autostep.maxHeight, options.autostep.minWidth, false);
    if (options.snapToGroundDistance !== undefined)
      controller.enableSnapToGround(options.snapToGroundDistance);
    const handle =
      `character-controller:${this.#nextCharacterController++}` as PhysicsCharacterControllerHandle;
    this.#characterControllers.set(handle, { collider: colliderHandle, controller });
    return handle;
  }

  moveCharacterController(
    handle: PhysicsCharacterControllerHandle,
    desiredTranslation: Vec3,
  ): CharacterControllerMovement {
    this.#assertActive();
    const record = this.#characterController(handle);
    if (!desiredTranslation.every(Number.isFinite))
      throw new PhysicsError(
        'physics.invalid-character-controller',
        'Character movement values must be finite',
      );
    const collider = this.#collider(record.collider).collider;
    record.controller.computeColliderMovement(collider, {
      x: desiredTranslation[0],
      y: desiredTranslation[1],
      z: desiredTranslation[2],
    });
    const movement = record.controller.computedMovement();
    const bodyRecord = this.#body(this.#collider(record.collider).body);
    const current = bodyRecord.body.translation();
    bodyRecord.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    const collisions: CharacterControllerMovement['collisions'][number][] = [];
    for (let i = 0; i < record.controller.numComputedCollisions(); i++) {
      const collision = record.controller.computedCollision(i);
      if (!collision?.collider) continue;
      const hit = this.#colliderByRapierHandle.get(collision.collider.handle);
      const hitRecord = hit ? this.#colliders.get(hit) : undefined;
      if (hitRecord)
        collisions.push({
          entity: hitRecord.entity,
          normal: [collision.normal1.x, collision.normal1.y, collision.normal1.z],
        });
    }
    return {
      translation: [movement.x, movement.y, movement.z],
      grounded: record.controller.computedGrounded(),
      collisions,
    };
  }

  removeCharacterController(handle: PhysicsCharacterControllerHandle): void {
    this.#assertActive();
    const record = this.#characterController(handle);
    record.controller.free();
    this.#characterControllers.delete(handle);
  }

  removeCollider(handle: PhysicsColliderHandle): void {
    this.#assertActive();
    const record = this.#colliders.get(handle);
    if (!record)
      throw new PhysicsError('physics.stale-handle', `Unknown collider handle: ${handle}`);
    for (const [controllerHandle, controller] of this.#characterControllers) {
      if (controller.collider === handle) {
        controller.controller.free();
        this.#characterControllers.delete(controllerHandle);
      }
    }
    this.#captureCollisionEvents();
    this.#queueCollisionExits(handle);
    this.#world.removeCollider(record.collider, true);
    this.#colliderByRapierHandle.delete(record.collider.handle);
    this.#colliders.delete(handle);
  }

  removeBody(handle: PhysicsBodyHandle): void {
    this.#assertActive();
    const record = this.#body(handle);
    this.#captureCollisionEvents();
    for (const [colliderHandle, collider] of this.#colliders) {
      if (collider.body === handle) {
        for (const [controllerHandle, controller] of this.#characterControllers) {
          if (controller.collider === colliderHandle) {
            controller.controller.free();
            this.#characterControllers.delete(controllerHandle);
          }
        }
        this.#queueCollisionExits(colliderHandle);
        this.#colliderByRapierHandle.delete(collider.collider.handle);
        this.#colliders.delete(colliderHandle);
      }
    }
    this.#world.removeRigidBody(record.body);
    this.#bodyByEntity.delete(record.entity);
    this.#bodies.delete(handle);
  }

  setKinematicTarget(handle: PhysicsBodyHandle, pose: PhysicsPose): void {
    this.#assertActive();
    const record = this.#body(handle);
    if (record.type !== 'kinematic')
      throw new PhysicsError(
        'physics.body-type-mismatch',
        'Kinematic target requires a kinematic rigid body',
      );
    this.#validatePose(pose);
    const body = record.body;
    const rotation = {
      x: pose.rotation[0],
      y: pose.rotation[1],
      z: pose.rotation[2],
      w: pose.rotation[3],
    };
    body.setNextKinematicTranslation({
      x: pose.position[0],
      y: pose.position[1],
      z: pose.position[2],
    });
    body.setNextKinematicRotation(rotation);
  }

  setStaticPose(handle: PhysicsBodyHandle, pose: PhysicsPose): void {
    this.#assertActive();
    const record = this.#body(handle);
    if (record.type !== 'static')
      throw new PhysicsError(
        'physics.body-type-mismatch',
        'Static pose update requires a static rigid body',
      );
    this.#validatePose(pose);
    const body = record.body;
    body.setTranslation({ x: pose.position[0], y: pose.position[1], z: pose.position[2] }, true);
    body.setRotation(
      { x: pose.rotation[0], y: pose.rotation[1], z: pose.rotation[2], w: pose.rotation[3] },
      true,
    );
  }

  getPose(handle: PhysicsBodyHandle): PhysicsPose {
    this.#assertActive();
    const body = this.#body(handle).body;
    const p = body.translation();
    const r = body.rotation();
    return { position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w] };
  }

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vec3, wakeUp = true): void {
    this.#assertActive();
    const record = this.#body(handle);
    if (record.type !== 'dynamic')
      throw new PhysicsError('physics.body-type-mismatch', 'Impulse requires a dynamic rigid body');
    this.#finite(impulse, 'Impulse');
    record.body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, wakeUp);
  }

  applyForce(handle: PhysicsBodyHandle, force: Vec3, wakeUp = true): void {
    this.#assertActive();
    const record = this.#body(handle);
    if (record.type !== 'dynamic')
      throw new PhysicsError('physics.body-type-mismatch', 'Force requires a dynamic rigid body');
    this.#finite(force, 'Force');
    record.body.addForce({ x: force[0], y: force[1], z: force[2] }, wakeUp);
  }

  step(deltaTime: number): boolean {
    this.#assertActive();
    if (!Number.isFinite(deltaTime) || deltaTime <= 0)
      throw new PhysicsError('physics.invalid-delta', 'Physics delta must be finite and positive');
    if (this.#paused && !this.#singleStepRequested) return false;
    this.#singleStepRequested = false;
    this.#world.timestep = deltaTime;
    this.#world.step(this.#events);
    return true;
  }

  raycast(ray: Ray, options: RaycastOptions = {}): RaycastHit | null {
    return this.raycastAll(ray, options)[0] ?? null;
  }

  raycastAll(ray: Ray, options: RaycastOptions = {}): readonly RaycastHit[] {
    this.#assertActive();
    this.#validateRay(ray);
    if (ray.maxDistance > this.#limits.maxRayDistance)
      throw new PhysicsError(
        'physics.resource-limit',
        `Ray maxDistance exceeds configured limit (${this.#limits.maxRayDistance})`,
      );
    if (
      options.collisionGroups !== undefined &&
      (!Number.isInteger(options.collisionGroups) ||
        options.collisionGroups < 0 ||
        options.collisionGroups > 0xffffffff)
    )
      throw new PhysicsError(
        'physics.query-invalid',
        'Query collision groups must be an unsigned 32-bit integer',
      );
    const direction = { x: ray.direction[0], y: ray.direction[1], z: ray.direction[2] };
    const origin = { x: ray.origin[0], y: ray.origin[1], z: ray.origin[2] };
    const rapierRay = new this.#rapier.Ray(origin, direction);
    const excluded = new Set(options.excludeEntities ?? []);
    const hits: RaycastHit[] = [];
    this.#world.intersectionsWithRay(
      rapierRay,
      ray.maxDistance,
      options.solid ?? true,
      (hit) => {
        const colliderHandle = this.#colliderByRapierHandle.get(hit.collider.handle);
        if (!colliderHandle) return true;
        const collider = this.#colliders.get(colliderHandle);
        if (!collider || excluded.has(collider.entity)) return true;
        const distance = hit.timeOfImpact;
        hits.push({
          entity: collider.entity,
          collider: colliderHandle,
          point: [
            origin.x + direction.x * distance,
            origin.y + direction.y * distance,
            origin.z + direction.z * distance,
          ],
          normal: [hit.normal.x, hit.normal.y, hit.normal.z],
          distance,
        });
        return true;
      },
      undefined,
      options.collisionGroups,
    );
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  drainCollisionEvents(): readonly CollisionEvent[] {
    this.#assertActive();
    this.#captureCollisionEvents();
    const result = this.#queuedCollisionEvents.splice(0);
    if (result.length > this.#limits.maxCollisionEventsPerDrain)
      throw new PhysicsError(
        'physics.resource-limit',
        `Collision event drain exceeded maxCollisionEventsPerDrain=${this.#limits.maxCollisionEventsPerDrain}; excess events were discarded`,
      );
    return result;
  }

  #captureCollisionEvents(): void {
    this.#events.drainCollisionEvents((handleA, handleB, started) => {
      const colliderA = this.#colliderByRapierHandle.get(handleA);
      const colliderB = this.#colliderByRapierHandle.get(handleB);
      if (!colliderA || !colliderB) return;
      const a = this.#colliders.get(colliderA);
      const b = this.#colliders.get(colliderB);
      if (!a || !b) return;
      const event: CollisionEvent = {
        entityA: a.entity,
        entityB: b.entity,
        colliderA,
        colliderB,
        started,
      };
      this.#queuedCollisionEvents.push(event);
      const key = this.#collisionPairKey(event);
      if (started) this.#activeCollisionPairs.set(key, event);
      else this.#activeCollisionPairs.delete(key);
    });
  }

  /** Removing a collider does not reliably yield Rapier end events; preserve one exit per tracked pair. */
  #queueCollisionExits(handle: PhysicsColliderHandle): void {
    for (const [key, event] of this.#activeCollisionPairs) {
      if (event.colliderA !== handle && event.colliderB !== handle) continue;
      this.#queuedCollisionEvents.push({ ...event, started: false });
      this.#activeCollisionPairs.delete(key);
    }
  }

  #collisionPairKey(event: CollisionEvent): string {
    return [event.colliderA, event.colliderB].sort().join('|');
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#characterControllers.values()) controller.controller.free();
    this.#characterControllers.clear();
    this.#events.free();
    this.#world.free();
    this.#bodies.clear();
    this.#bodyByEntity.clear();
    this.#colliders.clear();
    this.#colliderByRapierHandle.clear();
    this.#queuedCollisionEvents.length = 0;
    this.#activeCollisionPairs.clear();
  }

  #collider(handle: PhysicsColliderHandle): ColliderRecord {
    const record = this.#colliders.get(handle);
    if (!record)
      throw new PhysicsError('physics.stale-handle', `Unknown collider handle: ${handle}`);
    return record;
  }

  #characterController(handle: PhysicsCharacterControllerHandle): CharacterControllerRecord {
    const record = this.#characterControllers.get(handle);
    if (!record)
      throw new PhysicsError(
        'physics.stale-handle',
        `Unknown character controller handle: ${handle}`,
      );
    return record;
  }

  #body(handle: PhysicsBodyHandle): BodyRecord {
    const body = this.#bodies.get(handle);
    if (!body)
      throw new PhysicsError('physics.stale-handle', `Unknown rigid body handle: ${handle}`);
    return body;
  }

  #colliderDescriptor(descriptor: ColliderDescriptor): Rapier.ColliderDesc {
    const shape = descriptor.shape;
    let result: Rapier.ColliderDesc | null;
    switch (shape.type) {
      case 'box':
        this.#positive(shape.halfExtents, 'Box half-extents');
        result = this.#rapier.ColliderDesc.cuboid(...shape.halfExtents);
        break;
      case 'sphere':
        this.#positive([shape.radius], 'Sphere radius');
        result = this.#rapier.ColliderDesc.ball(shape.radius);
        break;
      case 'capsule':
        this.#positive([shape.halfHeight, shape.radius], 'Capsule dimensions');
        result = this.#rapier.ColliderDesc.capsule(shape.halfHeight, shape.radius);
        break;
      case 'cylinder':
        this.#positive([shape.halfHeight, shape.radius], 'Cylinder dimensions');
        result = this.#rapier.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        break;
      case 'convex-hull':
        if (
          shape.vertices.length < 12 ||
          shape.vertices.length % 3 !== 0 ||
          !Array.from(shape.vertices).every(Number.isFinite)
        )
          throw new PhysicsError(
            'physics.invalid-collider-descriptor',
            'Convex hull requires at least four finite 3D points',
          );
        if (shape.vertices.length / 3 > this.#limits.maxConvexHullVertices)
          throw new PhysicsError(
            'physics.resource-limit',
            `Convex hull exceeds maxConvexHullVertices=${this.#limits.maxConvexHullVertices}`,
          );
        result = this.#rapier.ColliderDesc.convexHull(shape.vertices);
        break;
      case 'triangle-mesh': {
        const vertexCount = shape.vertices.length / 3;
        if (
          shape.vertices.length < 9 ||
          shape.vertices.length % 3 !== 0 ||
          !Array.from(shape.vertices).every(Number.isFinite)
        )
          throw new PhysicsError(
            'physics.invalid-collider-descriptor',
            'Triangle mesh requires at least three finite 3D vertices',
          );
        if (shape.indices.length < 3 || shape.indices.length % 3 !== 0)
          throw new PhysicsError(
            'physics.invalid-collider-descriptor',
            'Triangle mesh indices must contain complete triangles',
          );
        if (vertexCount > this.#limits.maxTriangleMeshVertices)
          throw new PhysicsError(
            'physics.resource-limit',
            `Triangle mesh exceeds maxTriangleMeshVertices=${this.#limits.maxTriangleMeshVertices}`,
          );
        if (shape.indices.length > this.#limits.maxTriangleMeshIndices)
          throw new PhysicsError(
            'physics.resource-limit',
            `Triangle mesh exceeds maxTriangleMeshIndices=${this.#limits.maxTriangleMeshIndices}`,
          );
        for (let index = 0; index < shape.indices.length; index += 3) {
          const a = shape.indices[index]!;
          const b = shape.indices[index + 1]!;
          const c = shape.indices[index + 2]!;
          if (a >= vertexCount || b >= vertexCount || c >= vertexCount || a === b || b === c || c === a)
            throw new PhysicsError(
              'physics.invalid-collider-descriptor',
              `Triangle mesh contains invalid triangle indices at offset ${index}`,
            );
        }
        result = this.#rapier.ColliderDesc.trimesh(shape.vertices, shape.indices);
        break;
      }
      default:
        throw new PhysicsError(
          'physics.unsupported-shape',
          `Unsupported collider shape: ${String((shape as { type?: unknown }).type)}`,
        );
    }
    if (!result)
      throw new PhysicsError(
        'physics.unsupported-shape',
        `Rapier could not build ${shape.type} collider`,
      );
    if (descriptor.friction !== undefined) {
      if (!Number.isFinite(descriptor.friction) || descriptor.friction < 0)
        throw new PhysicsError(
          'physics.invalid-collider-descriptor',
          'Friction must be finite and non-negative',
        );
      result.setFriction(descriptor.friction);
    }
    if (descriptor.restitution !== undefined) {
      if (
        !Number.isFinite(descriptor.restitution) ||
        descriptor.restitution < 0 ||
        descriptor.restitution > 1
      )
        throw new PhysicsError(
          'physics.invalid-collider-descriptor',
          'Restitution must be in [0, 1]',
        );
      result.setRestitution(descriptor.restitution);
    }
    if (descriptor.density !== undefined) {
      if (!Number.isFinite(descriptor.density) || descriptor.density < 0)
        throw new PhysicsError(
          'physics.invalid-collider-descriptor',
          'Density must be finite and non-negative',
        );
      result.setDensity(descriptor.density);
    }
    if (descriptor.sensor !== undefined) result.setSensor(descriptor.sensor);
    if (descriptor.collisionGroups !== undefined) {
      if (
        !Number.isInteger(descriptor.collisionGroups) ||
        descriptor.collisionGroups < 0 ||
        descriptor.collisionGroups > 0xffffffff
      )
        throw new PhysicsError(
          'physics.invalid-collider-descriptor',
          'Collision groups must be an unsigned 32-bit integer',
        );
      result.setCollisionGroups(descriptor.collisionGroups);
    }
    result.setActiveEvents(this.#rapier.ActiveEvents.COLLISION_EVENTS);
    return result;
  }

  #validateBody(descriptor: RigidBodyDescriptor): void {
    this.#finite(descriptor.position, 'Body position');
    const rotation = descriptor.rotation ?? [0, 0, 0, 1];
    this.#finite(rotation, 'Body rotation');
    const norm = Math.hypot(...rotation);
    if (Math.abs(norm - 1) > 1e-3)
      throw new PhysicsError(
        'physics.invalid-body-descriptor',
        'Body rotation quaternion must be normalized',
      );
    for (const [name, value] of Object.entries({
      gravityScale: descriptor.gravityScale,
      linearDamping: descriptor.linearDamping,
      angularDamping: descriptor.angularDamping,
    })) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        throw new PhysicsError(
          'physics.invalid-body-descriptor',
          `${name} must be finite and non-negative`,
        );
    }
  }

  #validateRay(ray: Ray): void {
    if (!ray.origin.every(Number.isFinite) || !ray.direction.every(Number.isFinite))
      throw new PhysicsError(
        'physics.query-invalid',
        'Ray origin and direction values must be finite',
      );
    if (!Number.isFinite(ray.maxDistance) || ray.maxDistance < 0)
      throw new PhysicsError(
        'physics.query-invalid',
        'Ray maxDistance must be finite and non-negative',
      );
    if (Math.abs(Math.hypot(...ray.direction) - 1) > 1e-3)
      throw new PhysicsError('physics.query-invalid', 'Ray direction must be normalized');
  }

  #finite(values: readonly number[], label: string): void {
    if (!values.every(Number.isFinite))
      throw new PhysicsError('physics.invalid-body-descriptor', `${label} values must be finite`);
  }

  #positive(values: readonly number[], label: string): void {
    this.#finite(values, label);
    if (values.some((value) => value <= 0))
      throw new PhysicsError('physics.invalid-collider-descriptor', `${label} must be positive`);
  }

  #validatePose(pose: PhysicsPose): void {
    this.#finite(pose.position, 'Pose position');
    this.#finite(pose.rotation, 'Pose rotation');
    if (Math.abs(Math.hypot(...pose.rotation) - 1) > 1e-3)
      throw new PhysicsError(
        'physics.invalid-body-descriptor',
        'Pose quaternion must be normalized',
      );
  }

  #validateLimits(limits: PhysicsResourceLimits): void {
    for (const [name, value] of Object.entries(limits)) {
      if (name === 'maxRayDistance') continue;
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new PhysicsError(
          'physics.invalid-resource-limits',
          `${name} must be a positive safe integer`,
        );
    }
    if (!Number.isFinite(limits.maxRayDistance) || limits.maxRayDistance <= 0)
      throw new PhysicsError(
        'physics.invalid-resource-limits',
        'maxRayDistance must be finite and positive',
      );
  }

  #assertActive(): void {
    if (this.#disposed)
      throw new PhysicsError('physics.disposed', 'Physics world has been disposed');
  }
}
