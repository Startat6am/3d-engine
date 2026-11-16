# M6 — Physics & Input Acceptance

**Status:** implementation in progress; no M6 acceptance gate is claimed complete.  
**Milestone order:** M6 follows M5 and precedes M7. M10 AI authoring remains deferred.

This document is the M6 exit checklist. A gate passes only with implementation, automated evidence, documented limitations, and a verified browser example where specified.

## M6.0 — Contract and compatibility spike

- [x] Read and follow `SUBSYSTEM_CONTRACTS.md`.
- [x] Confirm package names, exports, TypeScript conventions, and runtime phase integration against current source.
- [x] Verify Rapier 0.21.0 / Apache-2.0, Vite WASM asset emission, lazy loading, and Chromium runtime simulation + raycast smoke; see ADR 0003.
- [ ] Verify deployment headers and additional target browsers.
- [ ] Review upstream Rapier maintenance/release cadence and record the supported browser matrix.
- [x] Publish the physics and input contracts, stable error categories, minimal examples, and explicit unsupported capabilities.
- [x] Keep backend-specific types out of public engine APIs.

## M6.1 — Physics adapter and world lifecycle

- [x] `@engine/physics` exposes an engine-owned `PhysicsWorld` interface and descriptors for bodies, colliders, filters, queries, and events.
- [x] Rapier is confined to an adapter module; no Rapier types appear in public package-root exports.
- [x] Tests can substitute a test-only FakePhysicsWorld and run the same PhysicsWorld conformance suite against Fake and Rapier (30 shared conformance tests pass).
- [ ] Initialization failure is actionable and does not corrupt ECS or serialized world state.
- [x] Create/destroy operations are safe; stale body/collider handles are rejected. Descriptor replacement is supported; in-place mutation of descriptor objects is not.
- [x] Disposal releases backend resources and is idempotent.

## M6.2 — Fixed-step simulation and transform authority

- [x] Physics consumes the existing `EngineRuntime` fixed-update ticks; no duplicate accumulator or render-loop physics stepping is introduced.
- [x] Fixed timestep defaults to 1/60 s and uses the existing bounded catch-up policy; pause and single-step semantics are tested.
- [x] Static, kinematic, and dynamic ownership rules are explicit and tested.
- [x] M6 root-body and unit-scale constraints are validated with actionable errors.
- [x] Physics-to-ECS synchronization occurs before transform propagation and renderer extraction.
- [x] No renderer interpolation writes to authoritative ECS Transform; interpolation remains unimplemented and is not part of the current gate.
- [x] Core clock tests cover zero/multiple fixed ticks and bounded long-frame catch-up; PhysicsSystem consumes the same fixed-update context.

## M6.3 — Colliders, events and queries

- [x] Box, sphere, capsule, cylinder, and convex-hull descriptors validate dimensions and finite values.
- [x] Configurable positive limits bound live bodies, live colliders, collision events per drain, ray length, and convex-hull vertex count; overflow is surfaced as a typed resource-limit error.
- [ ] Static triangle-mesh collider support is explicitly scoped and opt-in; unsupported mesh/body combinations fail clearly.
- [ ] Kinematic capsule character controller resolves movement against obstacles, reports grounded/collision normals, and is covered for flat ground, slope limits, autostep, snap-to-ground, and lifecycle cleanup. Initial API/lifecycle and flat-ground/snap-to-ground smoke tests exist. Rapier slope-limit integration tests (25° climbable with a 30° limit; 55° blocked by a 30° limit) passed exact-head CI run #343. Autostep integration tests were added in commit `0c548ae20eefb3c6661de8935f6a99ff82500aea` (0.4-unit step under a 0.45 limit; 0.8-unit step over the limit). Teardown/recreation and world-dispose/reinitialization tests were added in commit `625846e9ddaa6245ed3d7e23f4963d093fde1eda`; all new tests await exact-head CI.
- [x] Collision enter/exit events include stable entity and collider identities; sphere-sensor enter/exit are tested against both Fake and Rapier.
- [x] Removing a collider or body during active contact emits exactly one exit event with stable identities; covered by Fake/Rapier conformance tests.
- [x] Collision events obey mutual collision-group filtering; tested against Fake and Rapier.
- [x] Raycast and raycast-all return distance, world-space hit point/normal, entity identity, and collider identity.
- [x] Query filters support collision groups and excluded entities; nearest/all ordering and maximum distance are covered by the shared Fake/Rapier conformance suite.
- [x] Tests cover nearest-hit ordering, max distance, excluded entities, stale body/collider handles, collider validation, raycast misses, invalid ray values, invalid query collision groups, and removal of stale colliders from query results.

## M6.4 — Input mapping

- [x] `@engine/input` exposes device-independent actions, maps, contexts, and immutable fixed-tick snapshots.
- [ ] Keyboard/mouse action mapping is verified in Chromium through the Player Playground; verify the supported browser matrix and physical gamepad coverage before closing this gate.
- [x] Edge transitions survive frames with no fixed tick and are consumed once across multiple fixed ticks.
- [ ] Focus loss and gamepad disconnect neutralize state in browser hardware tests; pointer lock is not acquired by this adapter.
- [x] Context priority, dead zones, map validation, queue bounds, and listener disposal are unit-tested.
- [x] Gameplay-facing APIs use semantic actions; the input package does not expose DOM events to game systems.

## M6.5 — Editor UX and Physics Playground

M6 does not claim completion of the full Editor MVP. It does require that the new systems are discoverable and that existing visible UI does not misrepresent unfinished functionality.

- [x] Replace preview/foundation labels with truthful application and runtime status; no fake “READY” when renderer/runtime failed. Initial renderer and scene-save states are now derived from actual state.
- [x] Remove or hide non-functional component rows, dead controls, empty placeholder sections, and decorative status indicators until they have real behavior. Static Inspector component checkmarks and foundation/READY labels have been removed.
- [x] Keep working scene hierarchy, viewport, transform inspector, import, save/open, undo/redo, and diagnostics discoverable (existing Editor E2E remains green).
- [x] Add a focused Player Physics Playground demonstrating gravity, collision, body types, raycast, and keyboard-driven movement; Playwright exercises the browser route.
- [x] Expose real simulation pause/resume and single-step controls in the Player Physics Playground.
- [ ] Add physics debug visualization when implemented.
- [x] Show actionable loading/error/empty states; errors must not be hidden in console-only output.
- [x] Ensure the workspace remains usable at desktop and narrow mobile widths; no horizontal overflow or inaccessible critical controls (Playwright mobile viewport checks pass).
- [x] Browser smoke/E2E evidence is recorded for the Player Physics Playground and Editor at desktop and mobile viewports; screenshot review remains a final owner UX check.

## M6.6 — CI and documentation closeout

- [x] Local formatting, lint, typecheck, and 166 unit tests pass in the sandbox (Node 25; the repository-supported Node 22.12.x run remains to be repeated). Shared adapter conformance tests pass for Fake and Rapier (30 tests).
- [ ] Exact-head CI and browser E2E rerun; the previous submitted PR head reported 22/22 Playwright tests passing, but the current sandbox cannot launch Chromium because libglib-2.0.so.0 is missing.
- [ ] Physics performance report records body/collider counts, step/query timings, event allocations, memory, browser/runtime, and hardware context.
- [x] Known limitations and backend compatibility are recorded in the specs and ADRs.
- [ ] README, Roadmap, Execution Plan, subsystem specs, and ADRs receive final owner review for status consistency.
- [ ] Owner reviews the evidence and explicitly accepts M6 before M7 work begins.

## Explicit non-goals

- No AI-authoring implementation or milestone reorder.
- No full Editor MVP claim (gizmos, plugin system, complete asset browser, full command/transaction history).
- No touch action-map system or user-facing input remapping UI.
- No networking, rollback netcode, cross-platform deterministic lockstep, soft bodies, ragdolls, or unrestricted dynamic triangle meshes.
- No claim that fixed-step alone guarantees bit-identical simulation across browsers or hardware.

## Evidence record

Record PR/commit links, CI run IDs, browser/runtime versions, test counts, benchmark outputs, and reviewer sign-off here as work is completed. Empty evidence is an open gate, not an implicit pass.
