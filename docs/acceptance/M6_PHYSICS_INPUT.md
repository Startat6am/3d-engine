# M6 — Physics & Input Acceptance

**Status:** planning baseline; no M6 implementation is claimed complete.  
**Milestone order:** M6 follows M5 and precedes M7. M10 AI authoring remains deferred.

This document is the M6 exit checklist. A gate passes only with implementation, automated evidence, documented limitations, and a verified browser example where specified.

## M6.0 — Contract and compatibility spike

- [ ] Read and follow `SUBSYSTEM_CONTRACTS.md`.
- [ ] Confirm package names, exports, TypeScript conventions, and runtime phase integration against current source.
- [ ] Verify candidate Rapier version, WASM packaging/loading, browser support, license, bundle impact, and maintenance status; record the evidence in an ADR before pinning a dependency.
- [ ] Publish the physics and input contracts, stable error categories, minimal examples, and explicit unsupported capabilities.
- [ ] Keep backend-specific types out of public engine APIs.

## M6.1 — Physics adapter and world lifecycle

- [ ] `@engine/physics` exposes an engine-owned `PhysicsWorld` contract and descriptors for bodies, colliders, filters, queries, and events.
- [ ] Rapier is confined to an adapter module; tests can substitute a fake backend.
- [ ] Initialization failure is actionable and does not corrupt ECS or serialized world state.
- [ ] Create/destroy/reconfigure operations are safe; stale body/collider handles are rejected.
- [ ] Disposal releases backend and WASM resources and is idempotent.

## M6.2 — Fixed-step simulation and transform authority

- [ ] Physics consumes the existing `EngineRuntime` fixed-update ticks; no duplicate accumulator or render-loop physics stepping is introduced.
- [ ] Fixed timestep defaults to 1/60 s and uses the existing bounded catch-up policy; pause and single-step semantics are tested.
- [ ] Static, kinematic, and dynamic ownership rules are explicit and tested.
- [ ] M6 root-body and unit-scale constraints are validated with actionable errors.
- [ ] Physics-to-ECS synchronization occurs before transform propagation and renderer extraction.
- [ ] Render interpolation, if added, uses presentation data and never overwrites authoritative ECS transforms.
- [ ] Tests cover zero, one, and multiple fixed ticks per rendered frame, long-frame catch-up, pause, and single-step.

## M6.3 — Colliders, events and queries

- [ ] Box, sphere, capsule, cylinder, and convex-hull descriptors validate dimensions and limits.
- [ ] Static triangle-mesh collider support is explicitly scoped and opt-in; unsupported mesh/body combinations fail clearly.
- [ ] Collision enter/exit events include stable entity and collider identities and obey filtering.
- [ ] Raycast and raycast-all return distance, world-space hit point/normal, entity identity, and collider identity.
- [ ] Query filters support collision groups and excluded entities.
- [ ] Tests cover misses, nearest-hit ordering, max distance, filtering, stale entities, and event lifecycle.

## M6.4 — Input mapping

- [ ] `@engine/input` exposes device-independent actions, maps, contexts, and immutable fixed-tick snapshots.
- [ ] Keyboard, mouse, and standard gamepad adapters work in supported browsers.
- [ ] Edge transitions survive frames with no fixed tick and are consumed once across multiple fixed ticks.
- [ ] Focus loss, pointer-lock loss, and gamepad disconnect neutralize state.
- [ ] Context priority, binding conflicts, dead zones, validation, and listener disposal are tested.
- [ ] No gameplay code depends directly on DOM events.

## M6.5 — Editor UX and Physics Playground

M6 does not claim completion of the full Editor MVP. It does require that the new systems are discoverable and that existing visible UI does not misrepresent unfinished functionality.

- [ ] Replace preview/foundation labels with truthful application and runtime status; no fake “READY” when renderer/runtime failed.
- [ ] Remove or hide non-functional component rows, dead controls, empty placeholder sections, and decorative status indicators until they have real behavior.
- [ ] Keep working scene hierarchy, viewport, transform inspector, import, save/open, undo/redo, and diagnostics discoverable.
- [ ] Add a focused Physics Playground scene demonstrating gravity, collision, body types, raycast, and input-driven movement.
- [ ] Expose only real physics controls: simulation pause/resume, single-step, and relevant debug visualization when implemented.
- [ ] Show actionable loading/error/empty states; errors must not be hidden in console-only output.
- [ ] Ensure the workspace remains usable at desktop and narrow mobile widths; no horizontal overflow or inaccessible critical controls.
- [ ] Visual smoke review is recorded with screenshots or browser evidence at representative desktop and mobile viewports.

## M6.6 — CI and documentation closeout

- [ ] Unit, adapter-conformance, integration, build, lint, typecheck, and browser E2E checks pass.
- [ ] Performance report records body/collider counts, step/query timings, event allocations, memory, browser/runtime, and hardware context.
- [ ] Known limitations and backend compatibility are recorded.
- [ ] README, Roadmap, Execution Plan, subsystem specs, and ADRs agree on the actual status.
- [ ] Owner reviews the evidence and explicitly accepts M6 before M7 work begins.

## Explicit non-goals

- No AI-authoring implementation or milestone reorder.
- No full Editor MVP claim (gizmos, plugin system, complete asset browser, full command/transaction history).
- No touch action-map system or user-facing input remapping UI.
- No networking, rollback netcode, cross-platform deterministic lockstep, soft bodies, ragdolls, or unrestricted dynamic triangle meshes.
- No claim that fixed-step alone guarantees bit-identical simulation across browsers or hardware.

## Evidence record

Record PR/commit links, CI run IDs, browser/runtime versions, test counts, benchmark outputs, and reviewer sign-off here as work is completed. Empty evidence is an open gate, not an implicit pass.
