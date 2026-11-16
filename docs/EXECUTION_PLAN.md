# M6 Execution Plan — Physics/Input

Updated: 2026-11-16

PR: [#87](https://github.com/Startat6am/3d-engine/pull/87)
Branch: `feat/m6-physics-input-core`

## Verified

- Local Node.js 22.13.0 / pnpm 12.18.0:
  - `pnpm check` passed (176/176 Vitest tests, format, lint, typecheck, builds).
  - `pnpm e2e` passed (22/22 Chromium tests).
- GitHub Actions #367 passed on code commit `619d4f780129adbfc52b002d98037a7f23381387`.
- GitHub Actions #369 and #370 passed on subsequent documentation commits.
- GitHub Actions #371 failed only on Prettier for the long status sections in
  `PROJECT_HANDOFF.md` and this file. Those sections are being replaced with
  concise formatted status summaries; check the new HEAD's CI.
- Vercel Preview for the code-bearing commit is READY and SSO-protected.

## Completed M6 implementation

1. Rapier character controller: slope limits, autostep, snap-to-ground,
   offset/up, grounded state, and collision results.
2. Physics lifecycle: entity/body/collider teardown, world disposal,
   reinitialization, and WASM init-failure recovery tests.
3. FakePhysicsWorld and Rapier share a conformance test contract.
4. Input: keyboard, mouse, gamepad, focus/visibility loss, disconnect,
   reconnect, axis/button neutralization, and transition coverage.
5. Preliminary performance report and reproducible Node benchmark.

## Remaining work

1. **Final CI:** confirm the workflow on the new documentation HEAD after
   fixing the Prettier-only failure in run #371.
2. **Deployment:** use an authorized browser session to inspect `.wasm`
   Content-Type, cache headers, CORS, and fallback behavior. Do not infer
   these from an unauthenticated SSO response.
3. **Browser matrix:** verify Firefox and WebKit; Chromium is the current
   automated E2E browser. Test physical gamepads and mobile where available.
4. **Physics scope:** confirm static/triangle-mesh requirements and add
   coverage if they are part of M6. Keep fixed-tick semantics under review.
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
