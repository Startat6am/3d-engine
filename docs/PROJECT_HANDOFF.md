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
- Run #371 failed only at Prettier because the status section added to this
  document and the execution plan was not formatted. The two documents are
  being rewritten concisely; do not treat #371 as a code/test failure.
- Check Actions for the new HEAD after the documentation correction.

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
