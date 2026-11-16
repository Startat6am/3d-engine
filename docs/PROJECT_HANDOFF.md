# Project Handoff — Choreon / 3D Engine

**Last updated:** 2026-11-16
**Repository:** `Startat6am/3d-engine`
**Active milestone:** M6 — Physics & Input
**Active branch:** `feat/m6-physics-input-core`\n**Latest GitHub commit:** `ef58e6c38b2bd0d1fa6d50a3149e6c468d465d4e` — character-controller API and initial Rapier floor-contact evidence.
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
- Both `FakePhysicsWorld` and Rapier run the same 13 conformance cases (26 total passing tests): body create/read/update/remove and stale handles; collider ownership on body removal; pause/single-step; sphere sensor collision enter/exit events with stable identities; exactly-once exit events on collider/body removal; nearest-first/all raycasts with collision-group filtering, entity exclusion, and max distance; mutual collision-group filtering for contact events; invalid ray/query input rejection; stale collider removal from query results; kinematic capsule controller movement contract and collider-removal invalidation; empty query/event behavior; idempotent disposal and disposed-state rejection.
- Fake backend models the `PhysicsWorld` contract with deliberately limited sphere raycasts and sphere/sphere overlap events; it is not a full geometry implementation or production solver. It is not exported from the package root and is not production functionality.
- Vitest now includes `packages/**/test/**/*.test.ts` in addition to existing source tests.

### Input and Player

- `@engine/input` supports semantic actions, action maps/contexts, keyboard/mouse/gamepad adapters, fixed-tick snapshots, dead zones, queue bounds, and disposal.
- Physical gamepad hardware and broader browser coverage remain unverified.
- Player Physics Playground demonstrates gravity, collision, keyboard movement, raycast, pause/resume, and single-step.

## 4. Current verification snapshot

Character-controller API and Rapier floor-contact smoke are implemented. Focused verification: TypeScript project build and 36/36 physics adapter/conformance tests passed; full workspace checks are pending. The pinned pnpm 12.18.0 executable is absent from this sandbox, so commands were run through the installed project binaries rather than claiming a successful `pnpm check`.

The submitted PR #87 head previously reported 22/22 Chromium Playwright E2E tests passing. Re-running pnpm e2e attempted all 22 tests, but all 22 failed before test execution because Chromium could not load the host library `libglib-2.0.so.0`. This is an environment limitation; no E2E test body ran and this is not a passing E2E run. Re-run CI on the exact PR head and record its run ID.

The repository declares Node `>=22.12.0 <23` and pnpm `12.18.0`. Prefer the declared runtime for final verification. The current sandbox uses Node 25; do not present that as the supported runtime. Re-run the final gate under Node 22.12.x.

## 5. Remaining M6 work — recommended order

1. **Character Controller integration evidence:** add Rapier obstacle tests for slope limits and autostep; flat-ground contact and snap-to-ground are covered. Fake coverage verifies only contract/lifecycle.
2. **Initialization/lifecycle hardening:** failed WASM init, repeated create/dispose, cleanup on partial failure, actionable errors.
3. **Input/browser evidence:** focus loss, visibility changes, gamepad disconnect, supported browser matrix, physical gamepad where hardware is available.
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
