import type { EntityId } from '@engine/core';
import type * as Rapier from '@dimforge/rapier3d';
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
  readonly #colliderByRapierHandle = new Map<number, PhysicsColliderHandle>();
  #nextBody = 1;
  #nextCollider = 1;
  #paused = false;
  #singleStepRequested = false;
  #disposed = false;

  private constructor(rapier: RapierModule, gravity: Vec3) {
    this.#rapier = rapier;
    this.#world = new rapier.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    this.#events = new rapier.EventQueue(true);
  }

  static async create(options: { readonly gravity?: Vec3 } = {}): Promise<RapierPhysicsWorld> {
    try {
      const rapier = await rapierLoader();
      return new RapierPhysicsWorld(rapier, options.gravity ?? [0, -9.81, 0]);
    } catch (cause) {
      throw new PhysicsError(
        'physics.backend-init-failed',
        'Rapier WebAssembly initialization failed',
        { cause },
      );
    }
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
    const colliderDescriptor = this.#colliderDescriptor(descriptor);
    const collider = this.#world.createCollider(colliderDescriptor, body.body);
    const handle = `collider:${this.#nextCollider++}` as PhysicsColliderHandle;
    this.#colliders.set(handle, { entity: body.entity, body: bodyHandle, collider });
    this.#colliderByRapierHandle.set(collider.handle, handle);
    return handle;
  }

  removeCollider(handle: PhysicsColliderHandle): void {
    this.#assertActive();
    const record = this.#colliders.get(handle);
    if (!record)
      throw new PhysicsError('physics.stale-handle', `Unknown collider handle: ${handle}`);
    this.#world.removeCollider(record.collider, true);
    this.#colliderByRapierHandle.delete(record.collider.handle);
    this.#colliders.delete(handle);
  }

  removeBody(handle: PhysicsBodyHandle): void {
    this.#assertActive();
    const record = this.#body(handle);
    for (const [colliderHandle, collider] of this.#colliders) {
      if (collider.body === handle) {
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
    const result: CollisionEvent[] = [];
    this.#events.drainCollisionEvents((handleA, handleB, started) => {
      const colliderA = this.#colliderByRapierHandle.get(handleA);
      const colliderB = this.#colliderByRapierHandle.get(handleB);
      if (!colliderA || !colliderB) return;
      const a = this.#colliders.get(colliderA);
      const b = this.#colliders.get(colliderB);
      if (!a || !b) return;
      result.push({ entityA: a.entity, entityB: b.entity, colliderA, colliderB, started });
    });
    return result;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#events.free();
    this.#world.free();
    this.#bodies.clear();
    this.#bodyByEntity.clear();
    this.#colliders.clear();
    this.#colliderByRapierHandle.clear();
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
        result = this.#rapier.ColliderDesc.convexHull(shape.vertices);
        break;
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
    if (descriptor.collisionGroups !== undefined)
      result.setCollisionGroups(descriptor.collisionGroups);
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
    this.#finite(ray.origin, 'Ray origin');
    this.#finite(ray.direction, 'Ray direction');
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

  #assertActive(): void {
    if (this.#disposed)
      throw new PhysicsError('physics.disposed', 'Physics world has been disposed');
  }
}
