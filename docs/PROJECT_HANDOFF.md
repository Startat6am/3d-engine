# Project Handoff — Choreon / 3D Engine

**Last updated:** 2026-11-16
**Repository:** `Startat6am/3d-engine`
**Active milestone:** M6 — Physics & Input
**Active branch:** `feat/m6-physics-input-core`
**Active review:** [PR #87](https://github.com/Startat6am/3d-engine/pull/87)
**Milestone state:** in progress; do not merge or mark M6 complete without owner review.

> Read this file first when resuming work after a chat reset, context loss, or a new assistant session. It is a navigation index and current-state snapshot, not a replacement for source code, tests, or the authoritative acceptance checklist.

## 1. Instructions for the next session

1. Read `AGENTS.md` and this handoff. Do **not** read or use `DO_NOT_READ.md`; it is explicitly excluded by repository policy.
2. Inspect the live GitHub state before editing: PR #87, its head SHA, branch status, review comments, and CI checks. Never assume this handoff's commit is still the remote head.
3. Check `git status`, `git log -5 --oneline`, and the current branch. Preserve any user changes; do not reset, force-push, or overwrite work to make the tree clean.
4. Read `docs/EXECUTION_PLAN.md`, `docs/acceptance/M6_PHYSICS_INPUT.md`, `docs/PHYSICS_SPEC.md`, `docs/INPUT_SPEC.md`, and the relevant ADRs before making architectural changes.
5. Continue M6 only. Do not reorder milestones, start M7/M10 work, or claim M6 acceptance without evidence and explicit owner approval.
6. After each meaningful task, update this file, `docs/EXECUTION_PLAN.md`, the relevant subsystem spec/ADR, and the M6 checklist in the same change. Record commit SHA, exact commands, test counts, and limitations.

## 2. Product and milestone context

Choreon is a modular browser-first 3D engine with separate Editor and Player applications over shared engine packages. M2–M5 are complete. M6 adds Physics and Input. AI authoring remains at its later roadmap milestone; do not accelerate it.

M6 currently has initial `@engine/physics` and `@engine/input` packages, fixed-tick integration, a Player Physics Playground, a Rapier adapter, configurable physics resource limits, and focused Editor UX improvements. M6 is **not complete**.

## 3. Current M6 implementation

### Physics

- Engine-owned `PhysicsWorld` interface and descriptors in `packages/engine-physics/src/types.ts`.
- `RapierPhysicsWorld` adapter; Rapier 0.21.0 remains provisional and private to the adapter.
- Body types: static, kinematic, dynamic. Shapes: box, sphere, capsule, cylinder, convex hull.
- Fixed-step integration uses existing `EngineRuntime`/`EngineClock`; no second accumulator.
- `PhysicsPreUpdateSystem` creates handles before gameplay; `PhysicsSystem` steps and synchronizes dynamic poses.
- Configurable limits: body count, collider count, collision events per drain, ray distance, convex-hull vertex count. Defaults are `DEFAULT_PHYSICS_RESOURCE_LIMITS`.
- Collision event overflow is surfaced as `physics.resource-limit`, not silently truncated. Removing a collider or body with active contacts synthesizes one exit event per active pair before handles are invalidated.
- Descriptor replacement stages a replacement collider before removing the previous collider.

### Fake backend and adapter conformance

- Test-only fake: `packages/engine-physics/test/fake-physics-world.ts`.
- Shared suite: `packages/engine-physics/test/physics-world-conformance.test.ts`.
- Both `FakePhysicsWorld` and Rapier run the same 15 conformance cases (30 total passing tests): body create/read/update/remove and stale handles; collider ownership on body removal; pause/single-step; sphere sensor collision enter/exit events with stable identities; exactly-once exit events on collider/body removal; nearest-first/all raycasts with collision-group filtering, entity exclusion, and max distance; mutual collision-group filtering for contact events; invalid ray/query input rejection; stale collider removal from query results; kinematic capsule controller movement contract, option validation, and collider/body-removal invalidation; empty query/event behavior; idempotent disposal and disposed-state rejection.
- Fake backend models the `PhysicsWorld` contract with deliberately limited sphere raycasts and sphere/sphere overlap events; it is not a full geometry implementation or production solver. It is not exported from the package root and is not production functionality.
- Vitest now includes `packages/**/test/**/*.test.ts` in addition to existing source tests.

### Input and Player

- `@engine/input` supports semantic actions, action maps/contexts, keyboard/mouse/gamepad adapters, fixed-tick snapshots, dead zones, queue bounds, and disposal.
- Browser adapter unit coverage now verifies blur and document-visibility release behavior, clearing stale mouse delta/wheel input on focus loss, and neutralizing gamepad buttons/axes after disconnect. These are simulated EventTarget tests; physical gamepad hardware and the supported-browser matrix remain unverified.
- Player Physics Playground demonstrates gravity, collision, keyboard movement, raycast, pause/resume, and single-step.

## 4. Current verification snapshot

Character-controller API and Rapier floor-contact/snap-to-ground smoke are implemented. Rapier slope-limit tests were added (25° climbable with a 30° limit; 55° blocked by a 30° limit) and passed exact-head CI run #343. Two Rapier autostep tests were added in commit `0c548ae20eefb3c6661de8935f6a99ff82500aea` (0.4-unit step accepted with a 0.45 limit; 0.8-unit step rejected), and teardown/recreation plus world-dispose/reinitialization tests were added in commit `625846e9ddaa6245ed3d7e23f4963d093fde1eda`. A WASM initialization failure/recovery test was added in commit `b41401dd2496c5c974eefe69ede2721125840fda`. A full local validation on the pre-fix branch head in the Node 25.9 sandbox passed: workspace package builds, all-app TypeScript project checks, Prettier, ESLint, and 175/175 Vitest tests across 13 files (including the new Rapier autostep, lifecycle, and WASM init recovery cases plus browser-input focus/visibility/gamepad-disconnect cases). The 30/30 shared Fake/Rapier conformance tests also pass. This is not supported-runtime CI evidence. Subsequent exact-head GitHub Actions run #353 on commit `2a8bb4c523bf8d065268ca7a1601055296abb738` completed successfully, including 22/22 Chromium E2E tests, under the workflow runtime. A clean Vercel sandbox on Node 22.13.0 / pnpm 12.18.0 now passes full `pnpm check` (176/176 Vitest tests, format, lint, typecheck, and production builds) and `pnpm e2e` (22/22 Chromium tests) after the focus/gamepad fix. Exact-head CI and Preview must be rerun after publishing the follow-up commit. Production header/browser-matrix and physical-device gates remain open.

The current pre-fix PR head `2a8bb4c523bf8d065268ca7a1601055296abb738` passed all 22/22 Chromium Playwright E2E tests in GitHub Actions run #353. The local Vercel sandbox is a separate environment; after installing Playwright Chromium and system dependencies, all 22 tests also pass locally on the follow-up working tree.

The repository declares Node `>=22.12.0 <23` and pnpm `12.18.0`. The local Vercel sandbox used Node 22.13.0 because pnpm 12.18.0 refuses to run under Node 22.12.0; 22.13.0 satisfies the declared engine range.

### Latest follow-up validation — 2026-11-16

- Source review found a focus-loss bug: negative gamepad axes were not neutralized, and the next poll could restore stale state before focus returned. `BrowserInputAdapter` now clears all non-zero controls, suspends gamepad polling while blurred/hidden, and resumes it on focus/visibility restoration. A regression test covers negative axes, button release, and reconnect.
- Clean local validation after this change: Node 22.13.0 / pnpm 12.18.0 `pnpm check` passes (176/176 Vitest tests, format, lint, typecheck, package builds, and Editor/Player production builds); `pnpm e2e` passes 22/22 Chromium tests after installing Playwright Chromium and OS dependencies.
- A preliminary performance report and reproducible benchmark are recorded in `docs/PHYSICS_PERFORMANCE_REPORT.md` and `packages/engine-physics/bench/physics-performance.mjs`. It is not an acceptance sign-off; browser/device, controlled memory/WASM, allocation, dense-contact, and owner-budget evidence remain open.
- Follow-up code and documentation are published to PR #87 (input fix commit `37e3471`; report-format commit `ade9a94`; workload clarification commit `2750157`). GitHub Actions run #359 for the preceding documentation HEAD `1d2a3e9ac3ca95d96b56f52452d389bf04ac298a` completed successfully, including 22/22 Chromium E2E. The subsequent commits after run #359 are documentation-only updates (benchmark wording and verification-state synchronization); the physics/input implementation is unchanged. Final CI and Vercel Preview must be confirmed against the latest branch HEAD. The SSO-protected Preview has not been used to verify WASM response headers.

## 5. Remaining M6 work — recommended order

1. **Character Controller integration evidence:** slope-limit tests passed CI #343 on an earlier commit. Rapier autostep, teardown/recreation, world-dispose/reinitialization, and WASM init-failure/recovery tests now pass locally on the current branch head; obtain exact-head CI on the supported Node runtime before closing this gate. Flat-ground contact and snap-to-ground are covered. Fake coverage verifies only contract/lifecycle.
2. **Initialization/lifecycle hardening:** failed WASM init, repeated create/dispose, cleanup on partial failure, actionable errors.
3. **Input/browser evidence:** simulated unit tests cover focus loss, visibility changes, stale transient mouse input, and gamepad disconnect. Still verify the supported browser matrix and physical gamepad hardware where available.
4. **Rapier maintenance and deployment review:** release cadence, license/version review, WASM deployment headers, target browsers.
5. **Physics performance report:** body/collider counts, fixed-step and query timings, collision-event allocations, memory, browser/runtime, and hardware context.
6. **Final M6 owner review:** reconcile README, Roadmap, Execution Plan, specs, ADRs, checklist, CI and evidence. Only the project owner can accept M6 and authorize M7.

## 6. Commands

```sh
# Install exactly from lockfile
pnpm install --frozen-lockfile

# Fast focused contract tests
pnpm exec vitest run packages/engine-physics/test/physics-world-conformance.test.ts

# Physics adapter and system tests
pnpm exec vitest run packages/engine-physics/src/rapier-world.test.ts packages/engine-physics/src/physics-system.test.ts

# Full quality gate
pnpm check

# Browser E2E (requires Playwright Chromium and system libraries)
pnpm e2e

# Inspect branch state before and after changes
git status --short --branch
git log -5 --oneline --decorate
```

## 7. Source-of-truth map

- `AGENTS.md` — repository-specific engineering instructions.
- `docs/PROJECT_HANDOFF.md` — this recovery snapshot and next actions.
- `docs/EXECUTION_PLAN.md` — chronological implementation and verification record.
- `docs/acceptance/M6_PHYSICS_INPUT.md` — authoritative M6 exit checklist.
- `docs/PHYSICS_SPEC.md` / `docs/INPUT_SPEC.md` — subsystem contracts and limitations.
- `docs/ADR/0003-physics-backend-adapter.md` — physics backend isolation and Rapier decision.
- `docs/ADR/0004-physics-transform-authority.md` — transform authority and scheduler order.
- `docs/ROADMAP.md` — milestone sequence; do not reorder it.
- GitHub PR #87 and its exact-head CI — current review and remote evidence.

## 8. Handoff update template

For every continuation, replace the verification snapshot and next task with:

- Date/time and branch.
- Exact latest commit SHA and remote PR head SHA.
- Files changed and concise behavior summary.
- Exact commands run and pass/fail counts.
- CI run links/IDs for the exact commit.
- Known failures, environment limitations, and unverified assumptions.
- The single next task, its acceptance criteria, and relevant source/spec paths.

Never infer success from a command being started. Never mark an acceptance item complete without implementation and reproducible evidence.
