# Project Handoff — M6 Physics/Input

Updated: 2026-11-16

Repository: `Startat6am/3d-engine`
PR: [#87](https://github.com/Startat6am/3d-engine/pull/87)
Branch: `feat/m6-physics-input-core`

## Current verification

### Local

- Node.js 22.13.0 and pnpm 12.18.0.
- `pnpm check`: passed; 176/176 Vitest tests, format, lint, typecheck,
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
  passed on latest HEAD `f9e16974904c99f5e662f3b0eb3430546b1172b7`:
  format, lint, typecheck, 176/176 Vitest tests, builds, both GLB benchmarks,
  Playwright Chromium installation, and 22/22 Chromium E2E. The test asserts
  that the error-entry count increases after the missing-blob open action.

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

### Vercel

- Preview for code commit `619d4f780129adbfc52b002d98037a7f23381387` is READY.
- Preview requires Vercel SSO. No authorized browser inspection of the
  deployed `.wasm` response headers has been completed.

## Implemented

- Rapier-backed character controller with slope limits, autostep,
  snap-to-ground, offset/up configuration, grounded state, and collisions.
- Physics lifecycle integration with entity/body/collider teardown and
  world disposal/reinitialization coverage.
- Shared Fake/Rapier conformance contract.
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

- Verify deployed `.wasm` MIME, cache, CORS, and fallback headers through
  an authorized Vercel browser session.
- Verify Firefox/WebKit and physical gamepad/mobile behavior.
- Confirm whether static/triangle-mesh collider coverage is in M6 scope.
- Complete browser/device performance and memory/allocation profiling.
- Obtain owner review and M6 sign-off.

Do not close PR #87, merge, or mark M6 complete while any required gate is open.
