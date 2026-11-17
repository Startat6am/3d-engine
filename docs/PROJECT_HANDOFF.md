# Project Handoff — M6 Physics/Input

Updated: 2026-11-17

## Current state

- Repository: `Startat6am/3d-engine`
- PR: [#87 — feat: start M6 physics, input, and editor UX](https://github.com/Startat6am/3d-engine/pull/87)
- Branch: `feat/m6-physics-input-core`
- PR remains **open and Draft**. M6 is in progress; no exit gate or owner sign-off is claimed complete.
- M2–M5 remain complete. Do not reorder milestones or start M7/M10 work.

## Latest code and verification

- Latest fully verified app/code head: `19095ea8e35c9eb71f2702cc5c798652f3afa676` (the Player code is `ea2f82918b1acedd061715af237f00dd8f26216c`). Subsequent commits update only handoff/acceptance documentation.
- GitHub Actions run [#400](https://github.com/Startat6am/3d-engine/actions/runs/44038555177) passed on that exact head: format, lint, typecheck, 180/180 Vitest tests, package and app builds, both GLB benchmarks, and 22/22 Playwright Chromium E2E tests.
- Code head `6dd26d23e7a61d4bfac580f3c60f68ed9dc0ec8d` adds mouse-button jump and was verified by run #403.
- The mobile follow-up adds a touch HUD with holdable W/A/S/D and JUMP buttons. It uses pointer events through the existing semantic keyboard controls, releases held keys on pointer cancellation/blur/visibility loss, and has Chromium E2E coverage for mobile HUD visibility, forward movement and jump.
- GitHub Actions [run #423](https://github.com/Startat6am/3d-engine/actions/runs/44154047897) passed on exact PR head `19095ea8e35c9eb71f2702cc5c798652f3afa676`: format, lint, typecheck, Vitest, builds, both GLB benchmarks and the full Playwright Chromium E2E suite.

## Implemented M6 scope

- `@engine/physics`: engine-owned `PhysicsWorld` contract and Rapier 0.21.0 adapter; fixed-tick integration; body/collider lifecycle; events, raycasts, force/impulse; pause and single-step; resource limits; opt-in bounded static-only triangle meshes.
- Character controller: grounded state, slope limits, autostep, snap-to-ground and collision results, with integration/lifecycle coverage.
- `@engine/input`: semantic actions, prioritized contexts, immutable fixed-tick snapshots, keyboard/mouse/gamepad adapters, transient mouse input, and focus/visibility/disconnect neutralization.
- Editor UX cleanup: truthful renderer/save status, real empty-scene state, removal of decorative component placeholders.
- Player Physics Playground: Rapier WASM, gravity/collisions, dynamic and kinematic bodies, raycast, keyboard and touch-HUD movement/jump, pause/resume and single-step. Mouse jump and touch-HUD movement/jump are verified by Chromium E2E.

## Player staging deployment

- A separate Vercel project, `3d-engine-player`, builds from `apps/player`; the existing Editor project is unchanged.
- Public non-production staging alias: [Player](https://3d-engine-player-callback5.vercel.app/) · [Physics Playground](https://3d-engine-player-callback5.vercel.app/physics-playground.html). Vercel SSO protection is disabled for the Player project only; the Editor project is unchanged.
- The deployed root, `/physics-playground.html`, JS module and Rapier WASM asset were observed returning HTTP 200.
- WASM headers were verified: `Content-Type: application/wasm`, `Access-Control-Allow-Origin: *`, and `Cache-Control: public, max-age=0, must-revalidate`. A repeated request changed from Vercel cache MISS to HIT with the same ETag/last-modified timestamp.
- HTTP publication/header evidence is separate from interactive browser evidence. CI Chromium E2E verifies local Player initialization, physics, keyboard/mouse input and mobile-sized touch-HUD behavior. A real-device browser review of the public staging URL remains an owner acceptance item; no mobile-browser compatibility claim is made.
- The deployment is staging, not Production; no production domain promotion was performed.

## Remaining M6 gates

1. Verify deployed Player WASM initialization, failure/fallback behavior and interactive Playground behavior in an authorized Chrome session. HTTP status, MIME, CORS and cache headers are already verified.
2. Complete browser/device physics profiling: representative dense-contact and query workloads, controlled WASM-memory and allocation measurements, named hardware/browser context, and owner-approved budgets.
3. Complete the remaining Chromium input/browser evidence. Physical gamepad testing is optional separate evidence; simulated adapter tests do not prove physical hardware behavior.
4. Complete final visual review, confirm owner acceptance of the static-only triangle-mesh scope, and obtain explicit M6 owner sign-off.
5. Re-run full CI on the final PR head and update the acceptance checklist with exact evidence.

## Constraints

- M6 browser acceptance targets Chrome/Chromium only. Firefox/WebKit and mobile-browser compatibility are deferred; Chromium mobile viewport checks are responsive-layout tests only.
- Dynamic/kinematic triangle meshes and automatic mesh cooking remain deferred.
- Keep the standard non-SIMD Rapier browser build.
- Do not claim a memory ceiling from the preliminary shared-VM Node benchmark.
- Do not merge/close PR #87, mark M6 complete, or start M7/M10 while required gates remain open.
