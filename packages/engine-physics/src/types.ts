import type { EntityId } from '@engine/core';

export type Vec3 = readonly [number, number, number];
export type Rotation = readonly [number, number, number, number];
export type RigidBodyType = 'static' | 'dynamic' | 'kinematic';

export interface RigidBodyDescriptor {
  readonly type: RigidBodyType;
  readonly position: Vec3;
  readonly rotation?: Rotation;
  readonly gravityScale?: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly canSleep?: boolean;
}

export type ColliderShape =
  | { readonly type: 'box'; readonly halfExtents: Vec3 }
  | { readonly type: 'sphere'; readonly radius: number }
  | { readonly type: 'capsule'; readonly halfHeight: number; readonly radius: number }
  | { readonly type: 'cylinder'; readonly halfHeight: number; readonly radius: number }
  | { readonly type: 'convex-hull'; readonly vertices: Float32Array };

export interface ColliderDescriptor {
  readonly shape: ColliderShape;
  readonly friction?: number;
  readonly restitution?: number;
  readonly density?: number;
  readonly sensor?: boolean;
  readonly collisionGroups?: number;
}

export type PhysicsBodyHandle = string & { readonly __physicsBodyHandle: unique symbol };
export type PhysicsColliderHandle = string & { readonly __physicsColliderHandle: unique symbol };

export interface PhysicsPose {
  readonly position: Vec3;
  readonly rotation: Rotation;
}

export interface Ray {
  readonly origin: Vec3;
  /** Must be normalized. */
  readonly direction: Vec3;
  readonly maxDistance: number;
}

export interface RaycastOptions {
  readonly solid?: boolean;
  readonly collisionGroups?: number;
  readonly excludeEntities?: readonly EntityId[];
}

export interface RaycastHit {
  readonly entity: EntityId;
  readonly collider: PhysicsColliderHandle;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
}

export interface CollisionEvent {
  readonly entityA: EntityId;
  readonly entityB: EntityId;
  readonly colliderA: PhysicsColliderHandle;
  readonly colliderB: PhysicsColliderHandle;
  readonly started: boolean;
}

export interface PhysicsResourceLimits {
  /** Maximum live rigid bodies in one world. */
  readonly maxBodies: number;
  /** Maximum live colliders in one world. */
  readonly maxColliders: number;
  /** Maximum collision events returned by one drain operation. */
  readonly maxCollisionEventsPerDrain: number;
  /** Maximum ray length in world units. */
  readonly maxRayDistance: number;
  /** Maximum vertices accepted by one convex-hull descriptor. */
  readonly maxConvexHullVertices: number;
}

export const DEFAULT_PHYSICS_RESOURCE_LIMITS: PhysicsResourceLimits = Object.freeze({
  maxBodies: 10_000,
  maxColliders: 20_000,
  maxCollisionEventsPerDrain: 16_384,
  maxRayDistance: 10_000,
  maxConvexHullVertices: 65_536,
});

export interface PhysicsWorld {
  readonly paused: boolean;
  setPaused(paused: boolean): void;
  requestSingleStep(): void;
  createBody(entity: EntityId, descriptor: RigidBodyDescriptor): PhysicsBodyHandle;
  createCollider(body: PhysicsBodyHandle, descriptor: ColliderDescriptor): PhysicsColliderHandle;
  removeCollider(handle: PhysicsColliderHandle): void;
  removeBody(handle: PhysicsBodyHandle): void;
  setKinematicTarget(handle: PhysicsBodyHandle, pose: PhysicsPose): void;
  setStaticPose(handle: PhysicsBodyHandle, pose: PhysicsPose): void;
  getPose(handle: PhysicsBodyHandle): PhysicsPose;
  applyImpulse(handle: PhysicsBodyHandle, impulse: Vec3, wakeUp?: boolean): void;
  applyForce(handle: PhysicsBodyHandle, force: Vec3, wakeUp?: boolean): void;
  /** Returns true when a simulation tick was actually executed. */
  step(deltaTime: number): boolean;
  raycast(ray: Ray, options?: RaycastOptions): RaycastHit | null;
  raycastAll(ray: Ray, options?: RaycastOptions): readonly RaycastHit[];
  drainCollisionEvents(): readonly CollisionEvent[];
  dispose(): void;
}

export class PhysicsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PhysicsError';
  }
}
