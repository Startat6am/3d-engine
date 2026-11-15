# Physics Specification

**Status:** proposed M6 adapter contract  
**Target package:** `@engine/physics` (not yet implemented)  
**Contract version:** 0.1.0

## 1. Responsibility and boundaries

Integrate rigid-body simulation without making a third-party physics library the canonical entity, transform, or serialized world model.

- `engine-physics` owns engine-facing descriptors, `PhysicsWorld`, lifecycle-safe handles, queries, collision events, and backend adapters.
- `engine-core` remains the owner of ECS, entity identity, Transform, EngineRuntime, EngineClock, and scheduler phases.
- `engine-geometry` may provide CPU mesh data for explicitly supported static mesh collider cooking.
- Renderer consumes synchronized/presentation transforms and never steps or owns physics.
- Serialization stores engine-owned authoring configuration, never backend runtime handles or WASM objects.

## 2. Backend strategy

Rapier is the candidate backend, isolated behind the engine-owned adapter. No Rapier types may appear in public exports or serialized documents.

Before pinning a version, the M6 spike MUST verify package/version, license, browser support, WASM loading under Vite production builds, deployment headers, maintenance status, bundle size, and lazy-loading behavior. See [ADR 0003](ADR/0003-physics-backend-adapter.md).

The adapter must be replaceable and pass a backend-neutral conformance suite. Backend-specific capabilities are exposed through explicit capability metadata rather than leaking backend objects.

## 3. Coordinate and unit conventions

- Right-handed, Y-up world coordinates, consistent with the current engine transform/rendering convention.
- World distance units are treated as meters for physics.
- Quaternions use `[x, y, z, w]`.
- Linear velocity is meters/second; angular velocity is radians/second; gravity is meters/second².
- Collider dimensions are explicit physics-space dimensions. M6 rigid-body entities require unit ECS scale; non-unit scale is rejected rather than silently approximated.
- M6 rigid-body entities must be root entities (`Transform.parent === null`). Parent-aware rigid-body synchronization is deferred until inverse-world conversion and non-uniform-scale/shear semantics are specified.

## 4. Simulation and runtime integration

The existing `EngineRuntime` and `EngineClock` are the single source of fixed-step cadence. Physics MUST NOT create a second accumulator or call `step` from requestAnimationFrame/renderer callbacks.

- Default physics timestep: 1/60 second, supplied by the existing fixed-update context.
- Existing `EngineClock` defaults currently cap frame delta at 0.25 seconds and fixed catch-up at 5 steps. Physics consumes those ticks; it does not silently change these global clock defaults.
- Physics advances at most once per fixed-update tick.
- Pause prevents backend stepping while the core runtime may continue editor/UI updates.
- Single-step queues exactly one physics tick and is observable in tests.
- If physics is paused, force/impulse commands must follow a documented policy; the proposed policy is queue bounded commands until the next active tick or explicit reset, with overflow diagnostics.
- Physics synchronization writes dynamic poses into ECS before transform propagation.
- Optional render interpolation is presentation-only and MUST NOT mutate authoritative ECS Transform.

The exact order between gameplay fixed systems, physics stepping, and dynamic pose synchronization must be explicit and tested; incidental registration order is not a contract.

## 5. Body authority and lifecycle

| Body type | Authoritative source | Synchronization |
| --- | --- | --- |
| Static | ECS Transform/configuration | ECS pose/config edits update backend before next step |
| Kinematic | ECS/gameplay target | Target pose is submitted before the next physics step |
| Dynamic | Physics simulation | Physics pose is written to ECS after each fixed step |

Body and collider handles are opaque engine-owned identifiers with generation/lifecycle validation. Destroying an ECS entity destroys associated backend resources before stale references can be used. Reconfiguration is explicit and validated; backend state is not serialized.

See [ADR 0004](ADR/0004-physics-transform-authority.md).

## 6. M6 capability scope

Required:
- Static, kinematic, and dynamic rigid bodies.
- Gravity, linear/angular velocity, mass/density, friction, restitution, damping, and sleeping controls where supported by the chosen adapter.
- Box, sphere, capsule, cylinder, and convex-hull colliders.
- Collision groups/masks and sensor colliders.
- Collision enter/exit events with stable entity/collider identities.
- Raycast and raycast-all.
- Character controller suitable for a basic third-person/first-person playground.
- Deterministic lifecycle and disposal tests.

Restricted:
- Triangle-mesh colliders are opt-in and static-only in M6.
- Dynamic triangle meshes, soft bodies, joints, ragdolls, networking/rollback, and cross-platform lockstep determinism are out of scope.
- Character controller behavior is an adapter capability; it is not a full animation/motor framework.

## 7. Public API shape (proposed)

Public TypeScript types should remain engine-owned. Exact names must be reconciled with repository conventions before implementation.

```ts
interface PhysicsWorld {
  createBody(entity: EntityId, descriptor: RigidBodyDescriptor): PhysicsBodyHandle;
  removeBody(handle: PhysicsBodyHandle): void;
  createCollider(body: PhysicsBodyHandle, descriptor: ColliderDescriptor): ColliderHandle;
  removeCollider(handle: ColliderHandle): void;
  setPaused(paused: boolean): void;
  step(fixedDeltaTime: number): void;
  raycast(ray: Ray, options?: RaycastOptions): RaycastHit | null;
  raycastAll(ray: Ray, options?: RaycastOptions): readonly RaycastHit[];
  dispose(): void;
}
```

The final API must define force/impulse operations, kinematic target submission, collision event subscription, filtering, query coordinate spaces, and typed error results. This sketch is not a frozen public API.

Raycast input uses a world-space origin, normalized world-space direction, and finite non-negative max distance. Hit results include entity ID, collider ID, world-space point, world-space normal, and distance. `raycast` returns the nearest accepted hit; `raycastAll` returns hits sorted nearest-first. Excluded entities and collision-group filters are supported. Stale handles/entities are never returned as valid hits.

## 8. Errors and validation

Stable error categories include:
- `physics.backend-unavailable`
- `physics.backend-init-failed`
- `physics.invalid-body-descriptor`
- `physics.invalid-collider-descriptor`
- `physics.unsupported-shape`
- `physics.unsupported-transform`
- `physics.stale-handle`
- `physics.query-invalid`
- `physics.resource-limit`

Validate finite values, positive dimensions, mass/density constraints, normalized rotations/directions, collision group ranges, root-body/unit-scale restrictions, and configured resource limits at the boundary. Errors must include relevant entity/operation context and recovery guidance.

## 9. Performance, limits and security

Measure body/collider counts, broadphase/narrowphase/solver time, query time, event processing time, allocations, WASM/JS memory, and bundle impact. Record browser, hardware, scene size, and build mode. Avoid allocations in contact/event hot paths where practical.

Bound bodies, colliders, events, ray length, and mesh cooking work. Treat imported mesh data and project files as untrusted. Mesh cooking must have explicit triangle/vertex limits and cancellation/disposal semantics.

## 10. Tests and acceptance

Adapter conformance; fixed-step integration; zero/one/multiple steps; catch-up; pause/single-step; body authority; root/scale validation; collider shape validation; filtering; event enter/exit and disposal; raycast miss/nearest/all/filter/distance; character controller; stale handles; entity destruction; backend init failure/rollback; repeated disposal; Physics Playground browser E2E.

The authoritative M6 gates are in [M6 acceptance](acceptance/M6_PHYSICS_INPUT.md).