# Physics Specification

**Status:** proposed adapter contract.

## Responsibility
Integrate rigid-body simulation without making a third-party physics library the canonical world/entity model.

## Backend
Rapier is the candidate backend, isolated behind `PhysicsWorld`, body/collider descriptors, query, and event interfaces. Version, WASM distribution, browser support, and licensing are verified during the physics spike before pinning.

## Simulation
Fixed timestep with bounded catch-up and explicit pause/step controls. Physics owns simulation state for bodies while ECS components store authoring configuration and synchronized snapshots. Define authority and synchronization direction for dynamic, kinematic, and static bodies.

## Features
Rigid bodies, primitive/convex colliders, gravity, collision events, raycasts, character controller, and filtering. Mesh colliders are opt-in due to cost and backend constraints.

## Dependencies
Core entity/transform contracts; optional geometry for collider cooking. Renderer never participates in physics stepping.

## Performance
Measure body/collider counts, broadphase/narrowphase time, solver time, query time, and memory across representative scenes. Avoid allocations in contact/event hot paths.

## Errors
Invalid collider dimensions, unsupported shapes, stale handles, and backend initialization failures return typed errors. Backend failure must not corrupt world serialization.

## Tests and acceptance
Adapter conformance, fixed-step behavior, transform synchronization, collision filtering/events, raycasts, character movement, disposal, and Physics Playground example pass.
