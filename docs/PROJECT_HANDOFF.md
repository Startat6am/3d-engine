Checking formatting...
All matched files use Prettier code style!

# Project Handoff — M6 Physics/Input

Updated: 2026-11-18

## Current state

- Repository: `Startat6am/3d-engine`
- PR: [#87 — feat: start M6 physics, input, and editor UX](https://github.com/Startat6am/3d-engine/pull/87)
- Branch: `feat/m6-physics-input-core`
- PR remains **open and Draft**. M6 is in progress; no exit gate or owner sign-off is claimed complete.
- M2–M5 remain complete. Do not reorder milestones or start M7/M10 work.

## Latest code and verification

- Latest application/code head covered by full CI: `0bd6a6ed9889c60a1d4865283b03f66850e73084` (subsequent branch commits are documentation-only) (`docs(physics): require exact-head browser benchmark CI`).
- GitHub Actions run [#439](https://github.com/Startat6am/3d-engine/actions/runs/44321353518) passed on this exact head. It completed frozen install, format, lint, typecheck, 180/180 Vitest tests, package/app builds, both GLB stress benchmarks, Chromium installation, and **23/23 Playwright Chromium E2E tests**.
- The 23-test CI suite includes the production Rapier-WASM browser benchmark, Physics Playground controls, Editor mobile behavior, browser JS/WebGL resource lifecycle measurement, GLB asset lifecycle, and Player shutdown/resource cleanup.
- Independent Node.js 22.23.5 / pnpm 12.18.0 verification also passed `pnpm check` (180/180 Vitest, formatting, lint, typecheck, package and Editor/Player production builds); the complete local Playwright Chromium suite passed 23/23.
- PR remains open and Draft; passing exact-head CI does not replace the outstanding real-device/performance and owner acceptance gates.

## Implemented M6 scope

- `@engine/physics`: engine-owned `PhysicsWorld` contract and Rapier 0.21.0 adapter; fixed-tick integration; body/collider lifecycle; events, raycasts, force/impulse; pause and single-step; resource limits; opt-in bounded static-only triangle meshes.
- Character controller: grounded state, slope limits, autostep, snap-to-ground and collision results, with integration/lifecycle coverage.
- `@engine/input`: semantic actions, prioritized contexts, immutable fixed-tick snapshots, keyboard/mouse/gamepad adapters, transient mouse input, and focus/visibility/disconnect neutralization.
- Editor UX cleanup: truthful renderer/save status, real empty-scene state, removal of decorative component placeholders.
- Player Physics Playground: Rapier WASM, gravity/collisions, dynamic and kinematic bodies, raycast, keyboard and touch-HUD movement/jump, pause/resume and single-step. Mouse jump and touch-HUD movement/jump are verified by Chromium E2E.
- Player Physics Playground mobile controls follow-up (2026-11-18): replace the four-button touch D-pad with a circular analog virtual joystick (radial clamp, pointer capture/cancel, release on blur/visibility loss) while retaining the separate jump button. The joystick feeds the existing semantic Move action through the touch adapter. Movement speed is now `1.0` (previously `0.75`, +`0.25`); jump impulse is now `1.2 * sqrt(2.5)` (approximately `1.90`); this targets 2.5× jump height because ballistic apex height scales with impulse squared. The updated Physics Playground Chromium E2E passes, the full Playwright E2E suite passes, and `pnpm check` passes in the continuation sandbox (Node.js 25.9.0; project CI remains the canonical Node.js 22 verification). Exact-head GitHub Actions run [#477](https://github.com/Startat6am/3d-engine/actions/runs/44372351354) passed on commit `1c8e61fd853280011b6218feabd096b97fa8316a`, including the full Node.js 22 CI workflow.

## Player staging deployment

- Separate Vercel project `3d-engine-player` builds from `apps/player`; the existing Editor project is unchanged.
- Current branch deployment alias: [Player](https://3d-engine-player-git-feat-m6-physics-input-core-callback5.vercel.app/) · [Physics Playground](https://3d-engine-player-git-feat-m6-physics-input-core-callback5.vercel.app/physics-playground.html).
- Exact deployment inspected: [`3d-engine-player-28gv19fj3-callback5.vercel.app`](https://3d-engine-player-28gv19fj3-callback5.vercel.app/physics-playground.html), Vercel deployment `dpl_HzcPXyNrZZGkNhchJbgGr88xfdAa`, state READY, built from exact PR head `0bd6a6ed9889c60a1d4865283b03f66850e73084`.
- **Important alias correction:** the older generic `3d-engine-player-callback5.vercel.app` alias still resolves to the earlier `0260d980269b39ad673b2e8c1f33a56bd401546a` deployment. Do not use it as evidence for the latest branch head; use the branch alias or exact deployment URL above.
- Automated headless Chromium 158 / SwiftShader smoke against the exact latest deployment confirmed root and Playground HTTP 200, `WEBGL2 READY`, `WASM READY`, five bodies, and no page/console errors. The Rapier WASM request returned HTTP 200 with `Content-Type: application/wasm` and `Access-Control-Allow-Origin: *`.
- Desktop interaction verified: keyboard movement, raycast hit, pause stability, exactly one requested single-step (the player's Y position changed from 2.679 to 2.686 after reset/pause/step), and scene reset.
- Mobile-sized 360×780 interaction verified with real CDP touch events: touch-HUD forward movement, pointer release (`data-pressed=false`), jump response (Y 0.500 to 0.663 at approximately 50 ms), visible touch controls, and no horizontal overflow.
- This is automated headless/software-renderer evidence, not a real physical GPU/device benchmark or an interactive owner visual review. It does not close the real-device performance, physical gamepad, or owner sign-off gates.
- Deployment is staging, not Production; no production domain promotion was performed.

## Remaining M6 gates

1. Complete interactive owner review of the current deployed Player/Playground in a normal Chrome session, including visual appearance and runtime fallback/error behavior. Automated exact-head headless Chromium smoke is now complete; this does not count as owner visual sign-off.
2. Repeat the browser physics profile on named desktop hardware and at least one target device; complete controlled WASM-memory/allocation measurements and agree performance budgets. The current headless SwiftShader profile is supplemental only.
3. Automated exact-head Chromium input/browser evidence is complete (run #439, 23/23); physical gamepad testing is optional separate evidence and is not claimed by the simulated adapter tests.
4. Complete final visual review, confirm owner acceptance of the static-only triangle-mesh scope, and obtain explicit M6 owner sign-off.
5. Re-run full CI on any subsequent code changes; exact-head run #439 currently passes all 23 Chromium E2E tests.

## Constraints

- M6 browser acceptance targets Chrome/Chromium only. Firefox/WebKit and mobile-browser compatibility are deferred; Chromium mobile viewport checks are responsive-layout tests only.
- Dynamic/kinematic triangle meshes and automatic mesh cooking remain deferred.
- Keep the standard non-SIMD Rapier browser build.
- Do not claim a memory ceiling from the preliminary shared-VM Node benchmark.
- Do not merge/close PR #87, mark M6 complete, or start M7/M10 while required gates remain open.
