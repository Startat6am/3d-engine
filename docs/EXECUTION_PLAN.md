# M6 Execution Plan — Physics/Input

**Status: CLOSED (owner-directed functional milestone closure, 2026-11-19).**

Updated: 2026-11-19

## Scope and browser target

M6 follows M5 and precedes M7. AI authoring remains at its later milestone (M10). The required browser target is Chrome/Chromium only; Playwright Chromium is the sole mandatory browser E2E target. Firefox, Safari/WebKit and mobile-browser compatibility are deferred. Chromium mobile-sized viewports verify responsive layout only.

PR: [#87](https://github.com/Startat6am/3d-engine/pull/87)  
Branch: `feat/m6-physics-input-core`

## Implemented

1. Engine-owned `PhysicsWorld` API with Rapier 0.21.0 isolated behind an adapter.
2. Existing EngineRuntime fixed-tick integration, transform authority rules, pause/single-step and bounded catch-up.
3. Rigid bodies, colliders, collision events, raycast/raycast-all, filters, resource limits and opt-in static-only triangle meshes.
4. Kinematic capsule character controller with slope limits, autostep, snap-to-ground and lifecycle cleanup coverage.
5. `@engine/input` semantic action maps, contexts, fixed-tick snapshots, keyboard/mouse/gamepad adapters and focus/disconnect neutralization.
6. Editor UX cleanup and a Player Physics Playground with Rapier WASM, gravity, collisions, keyboard movement, raycast, pause/resume and single-step.
7. The Player Playground also maps left mouse button to Jump; Chromium E2E verifies the physical jump result.

## Verification

- Last fully verified PR head: `c515f99f0cbfb3be05a4a8001cf5891b1e4ee431`.
- GitHub Actions [run #400](https://github.com/Startat6am/3d-engine/actions/runs/44038555177) passed on that exact head: format, lint, typecheck, 180/180 Vitest tests, package/app builds, both GLB benchmarks and 22/22 Playwright Chromium E2E tests.
- Follow-up code head `6dd26d23e7a61d4bfac580f3c60f68ed9dc0ec8d` passed GitHub Actions [run #403](https://github.com/Startat6am/3d-engine/actions/runs/44145410947), including format, lint, typecheck, unit tests, builds, both GLB benchmarks and the full Playwright Chromium E2E suite.
- Local evidence recorded in the PR uses Node.js 22.13.0 and pnpm 12.18.0.

## Player deployment

A separate Vercel project `3d-engine-player` is linked to this repository with Root Directory `apps/player`; the Editor project was not changed. The non-production staging deployment is [Player Physics Playground](https://3d-engine-player-b8a06t4ge-callback5.vercel.app/).

The deployed Player root, Playground HTML, JS module and Rapier WASM asset returned HTTP 200. The WASM response was verified with `Content-Type: application/wasm`, `Access-Control-Allow-Origin: *`, and `Cache-Control: public, max-age=0, must-revalidate`; repeated fetches changed from cache MISS to HIT. This does not prove browser execution. An isolated headless Chromium attempt was redirected to Vercel SSO, so deployed Chrome initialization, fallback/error behavior and interactive behavior remain open pending an authorized browser session. No production deployment or domain promotion was performed.

## Deferred follow-ups (not M6 closure blockers)

1. [x] Owner reviewed the current deployed Player/Playground in normal Chrome on 2026-11-19 and reported no issues.
2. [x] Automated Chromium input/browser evidence is recorded; physical gamepad verification remains optional and is not inferred from simulated adapter tests.
3. [deferred] Physical desktop/target-device profiling, controlled WASM memory/allocation measurements, full rendered-frame/GPU profiling, and owner-approved numeric budgets. The owner has no nearby computer; closure proceeds without fabricating measurements.
4. [x] M6 scope is frozen at opt-in static-only triangle meshes. Dynamic/kinematic triangle meshes and automatic mesh cooking remain out of scope.
5. [ ] Latest documentation-head CI and PR merge governance remain to be checked separately; this is repository integration housekeeping, not an unrecorded M6 implementation gate.

## Rapier decision and constraints

- Keep `@dimforge/rapier3d@0.21.0` pinned for M6.
- Keep the standard non-SIMD browser build; do not add SIMD without measured need and compatibility evidence.
- Dynamic/kinematic triangle meshes and automatic mesh cooking remain deferred.
- The preliminary Node/Rapier report is directional only; it is not browser/device performance sign-off or an approved memory/performance budget.

M6 is closed as a functional milestone by owner direction. Start M7 only on a separate `feat/m7-*` branch. Keep M10 at its planned roadmap milestone.

## Owner review update — 2026-11-19

- The interactive Chrome review of the current deployed Player/Physics Playground is complete and reported OK by the owner. See `docs/PROJECT_HANDOFF.md` and `docs/acceptance/M6_PHYSICS_INPUT.md`.
- Real-device profiling remains the next open M6 gate. The repeatable capture procedure and results worksheet are in `docs/PHYSICS_DEVICE_PROFILE_TEMPLATE.md`; no hardware measurements or performance budgets are claimed yet.

## Closure record — 2026-11-19

The owner explicitly directed that M6 be documented and closed despite having no nearby computer for physical-device profiling. This plan therefore records functional M6 closure with a transparent profiling exception: existing Node/Rapier and headless Chromium results are diagnostic evidence only, not physical-hardware acceptance. Device/GPU/WASM-memory/allocation profiling and numeric budgets are deferred follow-ups. This decision does not claim those measurements passed. M7 can proceed independently; PR #87 still requires latest-head CI review and normal merge governance.
