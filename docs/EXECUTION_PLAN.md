# M6 Execution Plan — Physics/Input

Updated: 2026-11-17

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
7. A follow-up change adds mouse-button jump and a Chromium E2E assertion for the physical result; that change is pending CI verification.

## Verification

- Last fully verified PR head: `c515f99f0cbfb3be05a4a8001cf5891b1e4ee431`.
- GitHub Actions [run #400](https://github.com/Startat6am/3d-engine/actions/runs/44038555177) passed on that exact head: format, lint, typecheck, 180/180 Vitest tests, package/app builds, both GLB benchmarks and 22/22 Playwright Chromium E2E tests.
- Current follow-up code head: `6dd26d23e7a61d4bfac580f3c60f68ed9dc0ec8d`; Actions run #403 is the pending verification for the mouse-input E2E addition.
- Local evidence recorded in the PR uses Node.js 22.13.0 and pnpm 12.18.0.

## Player deployment

A separate Vercel project `3d-engine-player` is linked to this repository with Root Directory `apps/player`; the Editor project was not changed. The non-production staging deployment is [Player Physics Playground](https://3d-engine-player-b8a06t4ge-callback5.vercel.app/).

The deployed Player root, Playground HTML, JS module and Rapier WASM asset returned HTTP 200. The WASM response was verified with `Content-Type: application/wasm`, `Access-Control-Allow-Origin: *`, and `Cache-Control: public, max-age=0, must-revalidate`; repeated fetches changed from cache MISS to HIT. This does not prove browser execution. An isolated headless Chromium attempt was redirected to Vercel SSO, so deployed Chrome initialization, fallback/error behavior and interactive behavior remain open pending an authorized browser session. No production deployment or domain promotion was performed.

## Remaining work

1. Verify the deployed Player in an authorized Chrome session: WASM initialization, fallback/error behavior and interactive Playground behavior.
2. Finish Chromium input evidence; distinguish browser-adapter simulation tests from physical gamepad testing.
3. Profile representative browser/device physics workloads, dense contacts, queries, WASM memory and allocations. Record runtime/hardware context and obtain owner-approved budgets.
4. Complete visual review and obtain explicit owner acceptance of the static-only triangle-mesh scope.
5. Update `docs/acceptance/M6_PHYSICS_INPUT.md` with exact evidence, rerun full CI on the final PR head, and obtain M6 sign-off.

## Rapier decision and constraints

- Keep `@dimforge/rapier3d@0.21.0` pinned for M6.
- Keep the standard non-SIMD browser build; do not add SIMD without measured need and compatibility evidence.
- Dynamic/kinematic triangle meshes and automatic mesh cooking remain deferred.
- The preliminary Node/Rapier report is directional only; it is not browser/device performance sign-off or an approved memory/performance budget.

Do not merge/close PR #87, mark M6 complete, or start M7/M10 work while required gates remain open.
