# M6 Execution Plan — Physics/Input

Updated: 2026-11-17

PR: [#87](https://github.com/Startat6am/3d-engine/pull/87)
Branch: `feat/m6-physics-input-core`

## Verified

- Local Node.js 22.13.0 / pnpm 12.18.0:
  - `pnpm check` passed (178/178 Vitest tests, format, lint, typecheck, builds).
  - `pnpm e2e` passed (22/22 Chromium tests).
- GitHub Actions #367 passed on code commit `619d4f780129adbfc52b002d98037a7f23381387`.
- GitHub Actions #369 and #370 passed on subsequent documentation commits.
- GitHub Actions #373 passed format, lint, typecheck, unit tests, builds, and
  both GLB benchmarks, but E2E finished 21/22. The only failure was a
  Playwright strict-mode locator matching two accumulated Console entries in
  the directory-project missing-blob test.
- Fixed the test to assert that the matching error count increases after the
  action. Run #374 passed on the code-fix commit; run #386 passed on the code
  HEAD `910bc3687ad8c3a99bd1f853407b0987beb5e026`; run #387 passed on latest
  HEAD `9b1d2445b7cbcc3625250a2e73b8c13ccf487df7`, including 178/178 Vitest
  tests and 22/22 Chromium E2E. Run #390 passed on `222ffbb`.
- Run #392 passed on code HEAD `35e71ab15532b7800a32ffd04a7b688c30cb63d1`:
  180/180 Vitest tests, format, lint, typecheck, builds, both GLB benchmarks,
  Chromium installation, and 22/22 Chromium E2E. The added conformance test
  checks Fake/Rapier parity for single-step rejection and resume cancellation.
- Vercel Preview for the code-bearing commit is READY and SSO-protected.

## Completed M6 implementation

1. Rapier character controller: slope limits, autostep, snap-to-ground,
   offset/up, grounded state, and collision results.
2. Physics lifecycle: entity/body/collider teardown, world disposal,
   reinitialization, and WASM init-failure recovery tests.
3. FakePhysicsWorld and Rapier share a conformance test contract, including pause/single-step semantics. Rapier supports opt-in static-only triangle meshes with bounded vertex/index buffers and rejects non-static bodies.
4. Input: keyboard, mouse, gamepad, focus/visibility loss, disconnect,
   reconnect, axis/button neutralization, and transition coverage.
5. Preliminary performance report and reproducible Node benchmark.

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

## Remaining work

1. **Final CI:** exact-head Actions run #387 passed all jobs on
   `9b1d2445b7cbcc3625250a2e73b8c13ccf487df7`, including 178/178 Vitest
   tests and 22/22 Chromium E2E. Recheck after any further code or docs commits.
2. **Deployment:** use an authorized browser session to inspect `.wasm`
   Content-Type, cache headers, CORS, and fallback behavior. Do not infer
   these from an unauthenticated SSO response.
3. **Browser matrix:** verify Firefox and WebKit; Chromium is the current
   automated E2E browser. Test physical gamepads and mobile where available.
4. **Physics scope:** static-only triangle meshes are implemented and tested.
   Dynamic/kinematic meshes and automatic mesh cooking remain deferred; keep
   fixed-tick semantics under review.
5. **Performance:** repeat on dedicated hardware and target browsers; add
   controlled WASM-memory and allocation profiling plus dense-contact scenes.
   Obtain owner-approved budgets before checking the performance gate.
6. **Acceptance:** update every checkbox with evidence, obtain owner review,
   and leave unsupported items unchecked.

## Rapier dependency decision

- Keep `@dimforge/rapier3d@0.21.0` pinned for M6.
- Upstream release/version review is recorded in `docs/PHYSICS_SPEC.md`.
- Keep the standard non-SIMD browser build. Do not add SIMD without a
  demonstrated need and browser compatibility evidence.

Do not start M7/M10 work, close PR #87, merge, or mark M6 complete prematurely.
