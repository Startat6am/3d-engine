# Physics Specification

**Status:** M6 implementation in progress; public contract 0.1.0 is provisional  
**Target package:** `@engine/physics`  
**Acceptance:** [M6 Physics & Input](acceptance/M6_PHYSICS_INPUT.md)

## 1. Responsibility and boundaries

Integrate rigid-body simulation without making a third-party physics library the canonical entity, transform, or serialized world model.

- `engine-physics` owns engine-facing descriptors, the `PhysicsWorld` interface, lifecycle-safe handles, queries, collision events, ECS systems, and backend adapters.
- `engine-core` remains the owner of ECS, entity identity, Transform, EngineRuntime, EngineClock, and scheduler phases.
- Renderer consumes synchronized/presentation transforms and never steps or owns physics.
- Serialization stores engine-owned authoring configuration, never backend runtime handles or WASM objects.
- Gameplay systems obtain a body handle from `PhysicsSystem.getBodyHandle(entity)` and call engine-owned `PhysicsWorld` operations; they do not import Rapier.

## 2. Backend strategy

Rapier 0.21.0 is pinned provisionally behind the engine-owned adapter:

- Production: `@dimforge/rapier3d@0.21.0` (Apache-2.0).
- Tests: `@dimforge/rapier3d-compat@0.21.0` as a development-only dependency.
- `createPhysicsWorld()` returns the engine-owned `PhysicsWorld` interface. Rapier objects and types are not exported from the package root.
- Vite uses `vite-plugin-wasm`; editor/player builds target ESNext for native top-level-await support.

A production Vite smoke build emitted a separate ~1.17 MB WASM asset (~0.45 MB gzip) and a ~52 KB gzip lazy JS chunk. A Chromium runtime smoke test loaded WASM, simulated a dynamic body for 60 fixed steps (final Y=0.07456), and returned a raycast hit. Deployment-header and additional-browser verification remain open. See [ADR 0003](ADR/0003-physics-backend-adapter.md).

## 3. Coordinate and transform conventions

- Right-handed, Y-up world coordinates, consistent with the engine transform/rendering convention.
- World distance units are treated as meters for physics.
- Quaternions use `[x, y, z, w]` and must be normalized.
- Linear velocity is meters/second; angular velocity is radians/second; gravity is meters/second².
- M6 rigid-body entities must be root entities (`Transform.parent === null`) and use unit ECS scale. Unsupported transforms fail with `physics.unsupported-transform`; they are never silently approximated.
- Parent-aware bodies, non-uniform scale, and shear are deferred until world/local matrix conversion semantics are specified and tested.

## 4. Runtime integration and scheduler order

The existing `EngineRuntime` and `EngineClock` are the only fixed-step clock. Physics MUST NOT create a second accumulator or step from requestAnimationFrame/renderer callbacks.

Register systems in this order:

1. `PhysicsPreUpdateSystem` in `pre-update`: validate transforms, create/remove rigid bodies and colliders, and make handles available before fixed gameplay systems.
2. Gameplay fixed-update systems: read input snapshots, modify kinematic ECS targets, and apply forces/impulses through body handles.
3. `PhysicsSystem` in `fixed-update`, after gameplay systems: refresh body/collider state, submit static/kinematic poses, call `PhysicsWorld.step(context.deltaTime)` exactly once, drain collision events, and synchronize dynamic poses back into ECS.
4. Core transform propagation and renderer extraction run after fixed updates.

`SystemContext` exposes `fixedStepIndex` and `fixedStepCount` for each fixed tick. The existing `EngineClock` defaults cap frame delta at 0.25 seconds and fixed catch-up at 5 steps; physics consumes those ticks without changing the global clock defaults.

- Default fixed timestep is 1/60 second, supplied by the existing fixed-update context.
- `PhysicsWorld.step(dt)` returns `true` when it advanced the backend and `false` when paused without a queued step.
- `setPaused(true)` stops simulation while editor/UI updates may continue.
- `requestSingleStep()` queues one backend tick while paused; the next fixed-update consumes it. Dynamic poses are synchronized after that step even though the world remains paused. Unpausing clears a queued single-step.
- Forces/impulses update backend force/velocity state immediately; motion advances on resume or a requested single-step. There is no separate engine-side command queue yet.
- Render interpolation is not implemented. If added, it must use presentation-only state and never overwrite authoritative ECS Transform.

## 5. Body authority and lifecycle

| Body type | Authoritative source        | Synchronization                                               |
| --------- | --------------------------- | ------------------------------------------------------------- |
| Static    | ECS Transform/configuration | ECS pose is submitted before each physics step                |
| Kinematic | ECS/gameplay target         | Next kinematic pose is submitted before each physics step     |
| Dynamic   | Physics simulation          | Physics pose is written to ECS after each executed fixed step |

`PhysicsPreUpdateSystem` creates handles before gameplay fixed-update consumers run. `PhysicsSystem.getBodyHandle(entity)` and `getColliderHandle(entity)` return opaque handles or `null` when the entity has no registered body/collider. Destroying an ECS entity removes its backend resources. Replacing a descriptor object recreates the corresponding resource; backend state is never serialized.

## 6. Implemented and remaining capabilities

Initial adapter implementation:

- Static, kinematic-position, and dynamic rigid bodies.
- Gravity, gravity scale, linear/angular damping, sleep control.
- Box, sphere, capsule, cylinder, and convex-hull colliders.
- Friction, restitution, density, sensor colliders, collision groups.
- Collision enter/exit event draining with entity and collider identities.
- Raycast and raycast-all with world-space results, collision-group filtering, and excluded entities.
- Force/impulse operations, pause, single-step, ECS lifecycle and transform synchronization.
- Engine-owned kinematic capsule character controller with collision-resolved movement, grounded state, collision normals, configurable up direction, slope limits, optional autostep, and snap-to-ground.

Still required for M6 acceptance:

- Optional static-only triangle-mesh colliders (opt-in); no dynamic triangle meshes.

### Character controller scope (M6)

The initial controller is deliberately narrow: it moves an existing non-sensor capsule collider attached to a kinematic rigid body. The engine API accepts a desired world-space translation and returns the collision-resolved translation, grounded flag, and obstacle entity/normal pairs. The Rapier adapter owns the controller object; the public API exposes only engine handles and values. Offset, up direction, climb/slide slope thresholds, optional autostep, and optional snap-to-ground are configurable. Controller handles are invalidated and backend resources freed when explicitly removed, when their collider/body is removed, or when the world is disposed.

Call moveCharacterController once per fixed tick for a controlled collider; repeated calls before a simulation step replace the pending kinematic target rather than accumulating input. The controller does not own gravity, velocity, jump logic, input, or ECS transforms. Gameplay computes desired displacement (including gravity) and submits it once per fixed tick; the kinematic body remains under gameplay authority. Rapier's character query pipeline is refreshed by a simulation step, so the first movement query must follow an initial world step after scene colliders have been created. The test Fake backend is intentionally non-colliding and only verifies API/lifecycle behavior; grounding, slope, step, and obstacle resolution require Rapier integration tests. Dynamic-body pushing is disabled in this M6 scope. Triangle-mesh collider cooking remains separately deferred.

- Physics Playground performance report and broader browser/device verification.

A preliminary Node/Rapier microbenchmark is recorded in [M6 Physics Performance Report](PHYSICS_PERFORMANCE_REPORT.md). It measures 100/500/1,000-body fixed-step and raycast workloads plus a 925-event drain case on a shared virtualized Node host; it is not browser/device performance sign-off, and memory/allocation profiling remains incomplete.

The Rapier adapter now enforces configurable limits for live bodies, live colliders, collision events per drain, ray length, and convex-hull vertex count. Defaults are exported as `DEFAULT_PHYSICS_RESOURCE_LIMITS`; applications may override individual values through `createPhysicsWorld({ limits })`. Collision-event overflow drains the backend queue, retains no more than the configured limit, and throws `physics.resource-limit` so truncation is never silent.

Out of scope: soft bodies, joints, ragdolls, networking/rollback, and cross-platform lockstep determinism. Fixed-step alone does not guarantee bit-identical simulation across browsers or hardware.

## 7. Public API shape

The package root exposes engine-owned types and a `createPhysicsWorld()` factory. The backend implementation is private to the adapter.

```ts
interface PhysicsWorld {
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
  step(fixedDeltaTime: number): boolean;
  raycast(ray: Ray, options?: RaycastOptions): RaycastHit | null;
  raycastAll(ray: Ray, options?: RaycastOptions): readonly RaycastHit[];
  drainCollisionEvents(): readonly CollisionEvent[];
  dispose(): void;
}
```

Ray input uses a world-space origin, normalized world-space direction, and finite non-negative max distance. Hit results include entity ID, collider ID, world-space point/normal, and distance. `raycast` returns the nearest accepted hit; `raycastAll` returns hits nearest-first. Query filters support collision groups and excluded entities. Stale handles/entities are never returned as valid hits.

## 8. Errors and validation

Implemented stable error categories include:

- `physics.backend-init-failed`
- `physics.invalid-body-descriptor`
- `physics.invalid-collider-descriptor`
- `physics.unsupported-shape`
- `physics.unsupported-transform`
- `physics.stale-handle`
- `physics.query-invalid`
- `physics.invalid-delta`
- `physics.body-type-mismatch`
- `physics.not-paused`
- `physics.disposed`
- `physics.resource-limit` — configured body, collider, collision-event, ray-distance, or convex-hull vertex budget exceeded.
- `physics.invalid-resource-limits` — invalid resource limit configuration.

The backend-unavailable category remains reserved for a future adapter-discovery path. Validate finite values, positive dimensions, normalized rotations/directions, collision group ranges, and root-body/unit-scale restrictions at the boundary.

## 9. Performance, limits and security

Measure body/collider counts, broadphase/narrowphase/solver time, query time, event processing time, allocations, WASM/JS memory, and bundle impact. Record browser, hardware, scene size, and build mode. Avoid allocations in contact/event hot paths where practical.

Runtime limits are implemented for bodies, colliders, collision events per drain, ray distance, and convex-hull vertices. Triangle-mesh cooking is not implemented; any future mesh support must have explicit triangle/vertex limits and cancellation/disposal semantics before it is enabled. Treat imported mesh data and project files as untrusted.

## 10. Tests and acceptance

Current tests cover gravity stepping, pause/single-step, static/dynamic lifecycle, root/scale validation, collider validation, collision enter/exit events for sphere sensors, raycast miss/nearest/all/exclusion, stale handles, entity destruction, configured resource limits and explicit collision-event overflow, and the browser WASM smoke path. The Player Physics Playground now demonstrates gravity, collisions, body types, keyboard movement, raycast, pause, and single-step with browser E2E coverage. Character controller API and Rapier movement support are implemented; grounding/slope/step obstacle integration evidence, additional browsers/deployment headers, and performance budgets remain open. A test-only FakePhysicsWorld and shared Fake/Rapier PhysicsWorld conformance suite now cover lifecycle, pose synchronization, stale handles, pause/single-step, sphere-sensor collision enter/exit events, exactly-once exit events on collider/body removal, collision-group filtering for contact events, nearest/all ray queries, query-group filtering, excluded entities, empty queries/events, and disposal. When a collider or body with active contacts is removed, the Rapier adapter synthesizes one exit event per active pair before invalidating the associated handles. The fake backend mirrors this lifecycle contract and mutual collision-group filtering. The fake backend only approximates sphere ray intersections and sphere/sphere overlaps; it is not a general geometry solver.

The authoritative M6 exit checklist is [M6 acceptance](acceptance/M6_PHYSICS_INPUT.md).
