# M6 — Physics & Input Acceptance

**Status:** implementation in progress; no M6 acceptance gate is claimed complete.  
**Milestone order:** M6 follows M5 and precedes M7. M10 AI authoring remains deferred.

## Browser target and acceptance boundary

- **Chrome/Chromium only** is the M6 browser target. Playwright Chromium is the sole required browser E2E target.
- Firefox, Safari/WebKit, and mobile-browser compatibility are deferred and are not M6 blockers. Chromium E2E verifies the touch HUD at a mobile-sized viewport, including touch-pointer movement and jump, but does not claim mobile-browser compatibility.
- A separate non-production Vercel project publishes the Player artifact at the public staging alias `https://3d-engine-player-callback5.vercel.app/`; the Playground is `/physics-playground.html`. Vercel SSO protection is disabled for this Player project only. The Player root, Playground HTML, JS module and Rapier WASM asset returned HTTP 200; WASM MIME (`application/wasm`), CORS and cache behavior were verified. CI Chromium E2E verifies local runtime initialization and interaction; real-device review of the public deployment remains open.
- Physical gamepad behavior is not inferred from simulated adapter tests; record a real-device result only if hardware is actually tested.

This document is the M6 exit checklist. A gate passes only with implementation, automated evidence, documented limitations, and a verified browser example where specified.

## M6.0 — Contract and compatibility spike

- [x] Read and follow `SUBSYSTEM_CONTRACTS.md`.
- [x] Confirm package names, exports, TypeScript conventions, and runtime phase integration against current source.
- [x] Verify Rapier 0.21.0 / Apache-2.0, Vite WASM asset emission, lazy loading, and Chromium runtime simulation + raycast smoke; see ADR 0003.
- [ ] Review the public Player deployment in a real Chrome session, including WASM initialization, fallback/error behavior and interactive Playground behavior. HTTP publication and headers are verified; CI Chromium E2E verifies local runtime behavior. This real-deployment review is still an owner acceptance item; see `docs/PROJECT_HANDOFF.md`.
- [ ] Review upstream Rapier maintenance/release cadence and record the supported browser matrix. The upstream maintenance/version snapshot is documented in `docs/PHYSICS_SPEC.md` (JS binding 0.21.0 pinned; Rust changelog v0.35.0/v0.35.1 (2026-08-08); npm JS 0.21.0 is latest); Chrome/Chromium is the sole M6 target; Firefox/WebKit compatibility is deferred.
- [x] Publish the physics and input contracts, stable error categories, minimal examples, and explicit unsupported capabilities.
- [x] Keep backend-specific types out of public engine APIs.

## M6.1 — Physics adapter and world lifecycle

- [x] `@engine/physics` exposes an engine-owned `PhysicsWorld` interface and descriptors for bodies, colliders, filters, queries, and events.
- [x] Rapier is confined to an adapter module; no Rapier types appear in public package-root exports.
- [x] Tests can substitute a test-only FakePhysicsWorld and run the same PhysicsWorld conformance suite against Fake and Rapier (32 shared conformance tests pass; run #392).
- [ ] Initialization failure is actionable and does not corrupt ECS or serialized world state. Rapier WASM failure/recovery test passes in the local Node 22.13.0 suite (178/178); exact-head CI run #392 passed on commit `35e71ab15532b7800a32ffd04a7b688c30cb63d1` (180/180 Vitest tests).
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
- [x] Static triangle-mesh collider support is opt-in and restricted to static rigid bodies. Dynamic/kinematic bodies reject the shape; malformed indices and configured vertex/index resource-limit overflow are rejected before Rapier cooking. Rapier integration tests verify a dynamic body collides with the static mesh and ray queries identify it.
- [ ] Kinematic capsule character controller resolves movement against obstacles, reports grounded/collision normals, and is covered for flat ground, slope limits, autostep, snap-to-ground, and lifecycle cleanup. Initial API/lifecycle and flat-ground/snap-to-ground smoke tests exist. Rapier slope-limit integration tests (25° climbable with a 30° limit; 55° blocked by a 30° limit) passed exact-head CI run #343. Autostep integration tests pass locally (0.4-unit step under a 0.45 limit; 0.8-unit step over the limit). Teardown/recreation and world-dispose/reinitialization tests pass locally; the current branch also asserts `removeCollider` on collider-component removal and `removeBody` on entity destruction. Local full `pnpm check` passes on Node 22.13.0 / pnpm 12.18.0 (178/178 Vitest tests). Exact-head GitHub Actions run #386 passed all checks, including 178/178 Vitest and 22/22 Chromium E2E, on commit `910bc3687ad8c3a99bd1f853407b0987beb5e026`. Run #373 later had 21/22 E2E pass due to a strict-mode locator matching accumulated Console entries; the assertion is fixed. Exact-head Actions run #374 passed the code fix, run #386 passed the code HEAD, and run #392 passed current HEAD `35e71ab15532b7800a32ffd04a7b688c30cb63d1` with 180/180 Vitest tests and 22/22 Chromium E2E. The shared Fake/Rapier conformance suite also checks that `requestSingleStep()` is rejected while running and that unpausing cancels a queued single-step. Exact-head CI run #400 passed on `c515f99f0cbfb3be05a4a8001cf5891b1e4ee431` with 180/180 Vitest tests and 22/22 Chromium E2E.
- [x] Collision enter/exit events include stable entity and collider identities; sphere-sensor enter/exit are tested against both Fake and Rapier.
- [x] Removing a collider or body during active contact emits exactly one exit event with stable identities; covered by Fake/Rapier conformance tests.
- [x] Collision events obey mutual collision-group filtering; tested against Fake and Rapier.
- [x] Raycast and raycast-all return distance, world-space hit point/normal, entity identity, and collider identity.
- [x] Query filters support collision groups and excluded entities; nearest/all ordering and maximum distance are covered by the shared Fake/Rapier conformance suite.
- [x] Tests cover nearest-hit ordering, max distance, excluded entities, stale body/collider handles, collider validation, raycast misses, invalid ray values, invalid query collision groups, and removal of stale colliders from query results.

## M6.4 — Input mapping

- [x] `@engine/input` exposes device-independent actions, maps, contexts, and immutable fixed-tick snapshots.
- [x] Keyboard/mouse action mapping is verified in Chromium through the Player Playground. Keyboard movement and left-mouse-button jump are covered; the E2E asserts the player Y coordinate rises after a mouse click (run #403).
- [x] Mobile touch HUD exposes holdable W/A/S/D movement and JUMP buttons, routed through the same semantic actions as keyboard input. Chromium E2E checks HUD visibility, forward movement and jump at a mobile-sized viewport; exact-head full CI run #423 passed.
- [x] Edge transitions survive frames with no fixed tick and are consumed once across multiple fixed ticks.
- [ ] Focus loss, document visibility changes, and gamepad disconnect neutralize state. Simulated browser-adapter unit tests cover blur/visibility release, clearing accumulated mouse delta/wheel values, neutralizing positive and negative gamepad axes, and gamepad disconnect/reconnect transitions. Gamepad polling is suspended while blurred/hidden. Physical gamepad verification is optional separate evidence; Chrome browser-adapter behavior is the M6 target. Pointer lock is not acquired by this adapter.
- [x] Context priority, dead zones, map validation, queue bounds, and listener disposal are unit-tested.
- [x] Gameplay-facing APIs use semantic actions; the input package does not expose DOM events to game systems.

## M6.5 — Editor UX and Physics Playground

M6 does not claim completion of the full Editor MVP. It does require that the new systems are discoverable and that existing visible UI does not misrepresent unfinished functionality.

- [x] Replace preview/foundation labels with truthful application and runtime status; no fake “READY” when renderer/runtime failed. Initial renderer and scene-save states are now derived from actual state.
- [x] Remove or hide non-functional component rows, dead controls, empty placeholder sections, and decorative status indicators until they have real behavior. Static Inspector component checkmarks and foundation/READY labels have been removed.
- [x] Keep working scene hierarchy, viewport, transform inspector, import, save/open, undo/redo, and diagnostics discoverable (existing Editor E2E remains green).
- [x] Add a focused Player Physics Playground demonstrating gravity, collision, body types, raycast, keyboard-driven movement and mouse jump; Playwright exercises the browser route.
- [x] Add mobile touch HUD buttons for W/A/S/D and JUMP; Playwright verifies mobile-sized HUD visibility and touch-pointer movement/jump.
- [x] Expose real simulation pause/resume and single-step controls in the Player Physics Playground.
- [ ] Add physics debug visualization when implemented.
- [x] Show actionable loading/error/empty states; errors must not be hidden in console-only output.
- [x] Ensure the workspace remains usable at desktop and narrow mobile widths; no horizontal overflow or inaccessible critical controls (Playwright mobile viewport checks pass).
- [x] Browser smoke/E2E evidence is recorded for the Player Physics Playground and Editor in Chromium at desktop and mobile-sized viewports; the latter is responsive-layout emulation, not mobile-browser compatibility. Screenshot review remains a final owner UX check.

## M6.6 — CI and documentation closeout

- [x] Historical sandbox verification (Node 25; 166 tests) is superseded by exact-head GitHub Actions run #394 on `74209111a0a23a01c74a9c1e9082f588a0604170`; the full verify job passed. Run #392 on code HEAD `35e71ab15532b7800a32ffd04a7b688c30cb63d1` recorded 180/180 Vitest and 22/22 Chromium E2E.
- [x] Exact-head CI and browser E2E: GitHub Actions run #392 passed on commit `35e71ab15532b7800a32ffd04a7b688c30cb63d1`, including 180/180 Vitest tests and 22/22 Chromium Playwright tests. The browser-memory repeat-import assertion timeout was increased from 5 to 20 seconds after CI exposed a slow 2049×2049 texture import on the hosted runner. Local `pnpm e2e` also passes 22/22.
- [x] Mobile touch HUD follow-up: exact-head GitHub Actions run #423 passed on `19095ea8e35c9eb71f2702cc5c798652f3afa676`, including format, lint, typecheck, unit tests, builds, both GLB benchmarks and Playwright Chromium E2E for touch-HUD movement/jump.
- [ ] Physics performance report records body/collider counts, step/query timings, event allocations, memory, browser/runtime, and hardware context. A preliminary Node/Rapier report and reproducible benchmark exist (`docs/PHYSICS_PERFORMANCE_REPORT.md`), but browser/device profiling, controlled memory/WASM and allocation measurements, dense-contact workloads, and owner-approved budgets are still missing.
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
