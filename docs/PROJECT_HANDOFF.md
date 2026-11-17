# Project Handoff — M6 Physics/Input

Updated: 2026-11-17

## M6 browser target

- Required browser for M6 acceptance: **Chrome/Chromium only**. Playwright Chromium is the sole mandatory browser E2E target.
- Firefox, Safari/WebKit, and mobile browsers are outside this milestone's browser-compatibility acceptance scope; do not schedule them as M6 blockers or imply they passed. Chromium mobile-viewport layout tests remain useful responsive-UI checks, not mobile-browser support evidence.
- Chrome-only scope does not waive deployment verification: publish the Player artifact and verify actual WASM response MIME (`application/wasm`), cache behavior, CORS, and initialization/fallback errors in Chrome. This remains open until observed against the deployed Player asset.
- Gamepad unit/simulated-adapter coverage is not proof of physical gamepad testing. Record any real-device test separately if hardware becomes available.

Repository: `Startat6am/3d-engine`
PR: [#87](https://github.com/Startat6am/3d-engine/pull/87)
Branch: `feat/m6-physics-input-core`

## Current verification

### Local

- Node.js 22.13.0 and pnpm 12.18.0.
- `pnpm check`: passed; 178/178 Vitest tests, format, lint, typecheck,
  package builds, and Editor/Player production builds.
- `pnpm e2e`: passed; 22/22 Chromium tests.
- The repeat-import E2E assertion allows 20 seconds for the 2049×2049
  texture fixture; the hosted runner needed longer than the original 5-second wait.
- Physics teardown coverage asserts collider removal on component removal
  and body removal on entity destruction.

### GitHub Actions

- Run #367 passed on code-bearing commit `619d4f780129adbfc52b002d98037a7f23381387`.
- Run #369 passed on docs commit `9ec1ec5a2ae7529bbffea48295dc71fdd009542c`.
- Run #370 passed on docs commit `ed68fdcc5e257eec4864d2470724616842acf002`.
- Run #373 on `39e934f` passed format, lint, typecheck, unit tests, builds, and
  both GLB benchmarks; E2E had 21/22 pass. The sole failure was a strict-mode
  locator matching two accumulated Console entries in the directory-project
  missing-blob test, not a product failure.
- Run #374 passed on the code-fix commit `8725c60f789747672ec56f9a21ea2cabce68c2c0`.
- Run #377 passed on `17a206437202d2455952ece8ca44912a1feae644`; run #378
  passed on `f9e16974904c99f5e662f3b0eb3430546b1172b7`; run #386 passed on
  code-bearing commit `910bc3687ad8c3a99bd1f853407b0987beb5e026`; run #387
  passed on latest HEAD `9b1d2445b7cbcc3625250a2e73b8c13ccf487df7`:
  format, lint, typecheck, 180/180 Vitest tests, builds, both GLB benchmarks,
  Playwright Chromium installation, and 22/22 Chromium E2E. The test asserts
  that the error-entry count increases after the missing-blob open action.
- Run #390 passed on commit `222ffbbdfc8bd67bb7eebfb1d47ba9888fece2ee`.
- Run #392 passed on code HEAD `35e71ab15532b7800a32ffd04a7b688c30cb63d1`:
  format, lint, typecheck, 180/180 Vitest tests, builds, both GLB benchmarks,
  Playwright Chromium installation, and 22/22 Chromium E2E. The added shared
  conformance case verifies that single-step requests are rejected while
  running and that resuming cancels a queued single-step.

### Vercel deployment inspection — 2026-11-16

- Preview deployment for commit `55e5a2e5b0f5a5245d8d8f1af99cc508b38e35c1`
  is READY: [deployment](https://3d-engine-aoxftxuz0-callback5.vercel.app/).
- Authorized deployment fetch returned the editor root as HTTP 200 with
  `Content-Type: text/html; charset=utf-8`,
  `Cache-Control: public, max-age=0, must-revalidate`, and
  `Access-Control-Allow-Origin: *`.
- Its JS entry returned HTTP 200 with
  `Content-Type: application/javascript; charset=utf-8`,
  the same cache policy, and `Access-Control-Allow-Origin: *`.
- The deployed build log lists only the Editor bundle (177 modules); the
  Player Physics Playground route and the expected Player WASM asset both
  return HTTP 404. Thus this Preview does not currently publish the Player
  artifact. WASM MIME/cache/CORS and WASM fallback behavior remain unverified;
  do not infer them from the HTML/JS headers.
- The Vercel project needs a Player deployment target (or an intentionally
  combined deployment) before deployed Rapier WASM headers can be tested.
  No Vercel project/build settings were changed as part of this check.

### Latest exact-head verification — 2026-11-17

- GitHub Actions run #394 passed on documentation HEAD `74209111a0a23a01c74a9c1e9082f588a0604170`; the `verify` job completed successfully, including format, lint, typecheck, tests, builds, both GLB benchmarks, Playwright Chromium installation, and Chromium E2E.
- Vercel deployment for the same HEAD is READY: [Preview](https://3d-engine-pmdxrrm6q-callback5.vercel.app/). This does not change the separate finding below that the configured Preview currently publishes only the Editor bundle.


### Player deployment verification — 2026-11-17

- Created a separate Vercel project, `3d-engine-player`, linked to this repository with Root Directory `apps/player`. The project uses Node.js 22.x and allows workspace source files outside the app root; the existing Editor project was not changed.
- Deployed the exact PR HEAD `f641e47f48928085e0215116ae884f15a5571deb` to a non-production Vercel staging deployment: [Player deployment](https://3d-engine-player-b8a06t4ge-callback5.vercel.app/). Build completed successfully; output contains both `index.html` and `physics-playground.html`, plus the Rapier WASM and JS assets.
- Authorized HTTP fetches returned HTTP 200 for `/`, `/physics-playground.html`, the Rapier JS module, and `/assets/rapier_wasm3d_bg-C6GCbKVJ.wasm`.
- The WASM response was observed with `Content-Type: application/wasm` and `Access-Control-Allow-Origin: *`. Cache policy is `public, max-age=0, must-revalidate`; the first fetch was `x-vercel-cache: MISS`, and a repeated fetch was `HIT` with the same ETag and last-modified timestamp.
- This verifies asset publication and HTTP headers, not browser execution. Actual Chrome WASM initialization, runtime fallback/error behavior, and interactive Playground behavior against this deployment still need a real browser run.
- An initial deployment request was mistakenly inferred as Production by the API; it was canceled before completion. The successful deployment is explicitly targeted to `staging`; no production deployment or domain promotion was performed.

### Latest exact-head verification — 2026-11-17

- GitHub Actions run #397 passed on exact HEAD `f641e47f48928085e0215116ae884f15a5571deb`, including format, lint, typecheck, unit tests, builds, both GLB benchmarks, Playwright Chromium installation, and Chromium E2E.

### Vercel

- Preview for code commit `619d4f780129adbfc52b002d98037a7f23381387` is READY.
- Preview requires Vercel SSO. No authorized browser inspection of the
  deployed `.wasm` response headers has been completed.

## Implemented

- Rapier-backed character controller with slope limits, autostep,
  snap-to-ground, offset/up configuration, grounded state, and collisions.
- Physics lifecycle integration with entity/body/collider teardown and
  world disposal/reinitialization coverage.
- Shared Fake/Rapier conformance contract, including matching pause/single-step rejection and resume-cancellation semantics. Rapier also supports opt-in static-only triangle meshes with bounded vertex/index buffers and explicit rejection on dynamic/kinematic bodies.
- Keyboard, mouse, and gamepad input.
- Blur/visibility releases, transient mouse reset, gamepad disconnect and
  reconnect, and negative-axis neutralization.
- Regression tests for gamepad focus restoration and physics resource removal.
- E2E now asserts a newly emitted project-open error without assuming the
  Console contains only one matching historical entry.

## Performance evidence

- Preliminary Node/Rapier results and reproduction instructions are in
  `docs/PHYSICS_PERFORMANCE_REPORT.md`.
- Script: `packages/engine-physics/bench/physics-performance.mjs`.
- This is a shared-VM microbenchmark, not browser/device sign-off.
- Browser timings, controlled WASM memory, allocation profiling, dense-contact
  workloads, and approved performance budgets remain open.

## Upstream Rapier review

- JavaScript binding `@dimforge/rapier3d` is pinned at 0.21.0.
- Upstream JS package and Rust engine versions are independent.
- The release snapshot and build-variant decision are in `docs/PHYSICS_SPEC.md`.
- Keep the standard non-SIMD production build; no SIMD variant was added.

## Remaining gates

- Verify actual deployed Player/WASM initialization, runtime fallback/error behavior, and interactive Playground behavior in Chrome only. HTTP MIME, cache, and CORS headers are now verified. Firefox/WebKit and mobile-browser compatibility are explicitly deferred; physical gamepad testing is optional evidence, not a browser-matrix gate.
- Confirm the M6 owner accepts the static-only triangle-mesh scope; dynamic/kinematic meshes and mesh cooking remain deferred.
- Complete browser/device performance and memory/allocation profiling.
- Obtain owner review and M6 sign-off.

Do not close PR #87, merge, or mark M6 complete while any required gate is open.
