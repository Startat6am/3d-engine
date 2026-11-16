# Choreon Execution Plan

## Current verification status — 2026-11-16

This section supersedes older validation snapshots below. Keep M6 open.

### Locally verified

- Environment: Node.js 22.13.0, pnpm 12.18.0 (within the repository's declared Node `>=22.12.0 <23` range; pnpm 12.18.0 requires Node 22.13.0 or newer).
- `pnpm check`: passed — 176/176 Vitest tests, format, lint, typecheck, package builds, and Editor/Player production builds.
- `pnpm e2e`: passed — 22/22 Chromium tests. The browser-memory repeat-import assertion now allows 20 seconds for the 2049×2049 fixture; local full E2E passed after this adjustment.
- Physics lifecycle regression test now asserts collider removal when the ECS collider component is removed and body removal when its entity is destroyed.
- Preliminary Node/Rapier benchmark and methodology are recorded in `docs/PHYSICS_PERFORMANCE_REPORT.md`.

### Confirmed in GitHub Actions

- Run #367 passed on code-bearing commit `619d4f780129adbfc52b002d98037a7f23381387`: install, format, lint, typecheck, tests, production builds, both GLB stress benchmarks, Playwright Chromium installation, and 22/22 E2E.
- Run #370 is associated with the subsequent documentation-only maintenance snapshot commit `ed68fdcc5e257eec4864d2470724616842acf002`. Do not infer its terminal result from run #367; check its own Actions status.
- Earlier run #353 passed on the pre-follow-up commit `2a8bb4c523bf8d065268ca7a1601055296abb738`; it is historical, not evidence for the later input fix.

### Still unverified / acceptance remains open

- The SSO-protected Vercel Preview has not been accessed through an authorized browser to inspect actual `.wasm` Content-Type, cache headers, CORS, or fallback responses. Do not infer these from config or an unauthenticated response.
- Firefox/WebKit, physical gamepad hardware, and mobile browser coverage remain unverified; current browser E2E is Chromium.
- Performance evidence is a preliminary shared-VM Node microbenchmark only. Browser/device timings, controlled WASM memory, allocation profiling, dense-contact workloads, and owner-approved budgets remain open.
- Static-mesh/triangle-mesh physics scope, final owner review, and M6 sign-off remain open.

### Upstream Rapier maintenance

- JavaScript binding `@dimforge/rapier3d` is pinned at 0.21.0; npm currently lists 0.21.0 as latest. The upstream Rust changelog lists v0.35.0/v0.35.1 on 2026-08-08, following v0.34.0 on 2026-07-04 and v0.33.0 on 2026-06-05. This supports an active-maintenance assessment, not a guaranteed release schedule.
- The version and build-variant review is recorded in `docs/PHYSICS_SPEC.md`. Keep the standard non-SIMD build; no SIMD variant was introduced. Browser support and deployed WASM headers remain open.

---


**Last updated:** 2026-11-16
**Repository:** `Startat6am/3d-engine`
**Current milestone:** M6 — Physics & Input (implementation in progress)
**Previous milestone:** M5 — Assets & Serialization (complete)

This file is the current handoff point. Older stacked-PR notes have been superseded
by the M5 closeout recorded below. Historical implementation details remain in GitHub
PRs and `ASSETS_SERIALIZATION_STATUS.md`.

## Current state

- M2 Foundation, M3 Core & ECS, and M4 Geometry & renderer baseline are complete.
- M5 exit gates are complete: import/serialization/PBR/lifecycle checks, directory-project
  save/reopen, tampered-blob rollback, missing-blob rollback, and exact-head Previews.
- M5 does not claim a whole-tab/process memory ceiling or a physical GPU-VRAM budget.
- M6 implementation is in progress on a dedicated feature branch. Initial `@engine/input` and `@engine/physics` packages, fixed-tick integration, the Player Physics Playground, and focused Editor UX cleanup are implemented on the open PR #87 branch. M6 acceptance remains in progress; only individually evidenced checklist items are marked complete.
- Do not accelerate the AI-authoring milestone or change the agreed milestone order.

## M5 closeout — 2026-11-15

- PRs #73–#80 merged: PBR state/round-trip, import rollback, GLB peak-RSS budget,
  semantic material validation, worker import, shared cancellation, renderer teardown,
  and the content-addressed asset-store ADR.
- PR #82 merged: Editor directory-project storage with immutable SHA-256 asset blobs
  and a `worlds/main.world` manifest.
- PR #83 merged: Chromium renderer-heap and WebGL allocation lifecycle diagnostic.
- PR #84 merged: explicit missing-external-asset rejection and scene-preservation test.
- PR #81 was closed as superseded by PR #83.

### Verification

- CI #306 on PR #82: 108/108 unit tests, builds, both 128 MiB stress budgets,
  and 18/18 Chromium E2E.
- CI #319 on PR #83: full checks and 19/19 Chromium E2E.
- CI #321 on PR #84: 109/109 unit tests, builds, both stress budgets,
  and 19/19 Chromium E2E.
- PR #82 exact-head Preview: https://3d-engine-jay96nda1-callback5.vercel.app
- PR #83 exact-head Preview: https://3d-engine-qfdiynrx5-callback5.vercel.app
- PR #84 exact-head Preview: https://3d-engine-5pos7nzyy-callback5.vercel.app

### Project storage contract

- Directory projects store the JSON manifest at `worlds/main.world`.
- Binary assets live under `assets/sha256/<prefix>/<digest>.<ext>`.
- Save writes immutable blobs, verifies them, then writes the manifest last.
- Open validates paths, MIME types, and hashes before committing scene or asset state.
- Single-file `.world` import/export remains available as a portable fallback.
- Stale content-addressed blobs are retained. Automatic garbage collection is not
  implemented and must remain non-destructive if added later.

### Memory diagnostic interpretation

- Chromium samples renderer JavaScript heap through CDP and requested WebGL allocation
  sizes through API instrumentation.
- The diagnostic verifies tracked texture allocations return to zero and buffer
  allocations return to the 720-byte baseline after object removal.
- These values are not total tab/process RSS, physical VRAM residency, or a universal
  memory ceiling. Node peak-RSS benchmarks remain a separate measurement.

## Known limitations

- The importer supports the documented static GLB subset; external glTF resources,
  sparse accessors, skins, morph targets, and animation channels remain unsupported.
- Asset references are not yet integrated into Player packaging.
- Directory selection uses the browser File System Access API where available;
  standalone `.world` files remain the fallback.
- User-supplied model files in `dl-models-test/` must not be copied into public
  synthetic fixtures or benchmark artifacts without explicit approval.

## Engineering constraints

- Keep provider SDKs optional; core and Player must not depend on an AI provider.
- Project-file editing is a controlled adapter, not unrestricted filesystem access.
- Preserve the chain: prompt → structured specification → validation →
  controlled execution → verification → accepted result.
- Weak models must still use explicit contracts and deterministic validation.
- “AI proposes, the system validates, the engine executes.”

## M6 implementation handoff — 2026-11-15

- M6 architecture is the implementation baseline. Work remains in review and no gate is complete.
- `docs/PHYSICS_SPEC.md` defines the proposed physics adapter, existing EngineClock integration, authority rules, query surface, limits, and verification.
- `docs/INPUT_SPEC.md` defines device adapters, semantic mappings, contexts, and fixed-tick snapshot semantics.
- `docs/ADR/0003-physics-backend-adapter.md` records the pinned provisional Rapier 0.21.0 package, Apache-2.0 license, Vite WASM smoke build, and Chromium runtime verification; deployment-header checks remain open.
- `docs/ADR/0004-physics-transform-authority.md` defines conservative M6 root-body/unit-scale constraints and the tested input/gameplay/physics scheduler order.
- `docs/acceptance/M6_PHYSICS_INPUT.md` is the authoritative M6 exit checklist.
- The Editor received a bounded visual UX cleanup: truthful renderer/save states, removal of decorative component checkmarks/foundation labels, and actionable empty-scene state. This is not the full Editor MVP and does not reorder M7–M10.
- Initial `@engine/input` and `@engine/physics` packages are present. Rapier's standard WASM build was loaded in Chromium and exercised with fixed steps and raycast.

## M6 verification snapshot — 2026-11-16

- PR #87 reported `pnpm check` and `pnpm e2e` passing at its submitted head (129 unit tests, 22 Chromium E2E).
- Revalidated the updated branch in the existing Node 25 sandbox: Prettier check, ESLint, TypeScript project build, and 166 unit tests passed. The pinned pnpm 12.18.0 executable is unavailable in this sandbox, so this is not recorded as a successful `pnpm check`; production builds and exact-head CI remain to be verified. The local E2E attempt enumerated all 22 tests, but Chromium could not start because this sandbox lacks the system shared library libglib-2.0.so.0; no E2E test body ran. The submitted PR #87 head separately reported 22/22 Chromium E2E passing before the latest commits; CI must be rerun on the updated exact head. The repository's declared supported Node range remains 22.12.x.
- PR #87 `pnpm e2e`: 22 Playwright Chromium tests passed, including editor/mobile, asset serialization, renderer lifecycle, and memory benchmark coverage.
- Dedicated Rapier browser smoke: WASM loaded, a dynamic body completed 60 fixed steps (Y=0.07456), and raycast returned a hit.
- Production Vite smoke emitted a separate ~1.17 MB WASM asset (~0.45 MB gzip) and a ~52 KB gzip lazy JS chunk.
- Player Physics Playground: five-body gravity/collision scene, keyboard movement, raycast, pause/resume, and single-step; Playwright also checks the 360px layout.
- Resource limits are now implemented and covered: live body/collider counts, collision events per drain, ray distance, and convex-hull vertex count. Defaults are documented and overridable per world.
- Character controller: engine-owned kinematic capsule API, Rapier collision-resolved translation, grounded state and obstacle normals; flat-ground/snap-to-ground smoke passes. The Fake backend intentionally verifies contract/lifecycle only. Slope/autostep integration remains open.
- Latest local validation after controller implementation: TypeScript project build, Prettier, ESLint, and 166/166 unit tests across 13 files pass in the Node 25 sandbox. This is not the supported Node 22.12.x gate and production builds/E2E still need exact-head CI.
- Shared Fake/Rapier PhysicsWorld conformance suite: 30/30 tests pass across lifecycle, pose operations, stale handles, collider ownership, pause/single-step, sphere-sensor collision enter/exit events, exactly-once exit on collider/body removal, collision-event group filtering, nearest/all ray queries, query-group filtering, invalid ray/query inputs, stale collider removal from query results, character-controller movement contract, option validation and lifecycle, entity exclusion, empty query/event behavior, and disposal.
- Browser input unit coverage verifies blur/visibility release, transient mouse delta/wheel clearing, and gamepad button/axis neutralization after disconnect. These use simulated browser events/Gamepad API samples; physical-device E2E and the supported-browser matrix remain open.
- Current branch-head local validation in the Node 25.9 sandbox: workspace package builds, all-app TypeScript project checks, Prettier, ESLint, and 175/175 Vitest tests across 13 files pass, including Rapier autostep/lifecycle/WASM-init recovery and browser-input focus/visibility/disconnect cases. This does not replace CI on the required Node 22.12.x runtime.
- Still open: exact-head supported-runtime CI, deployment-header/target-browser checks, Rapier maintenance review, physical gamepad E2E, physics performance report, and owner M6 sign-off.

## Latest follow-up — 2026-11-16

- PR #87 HEAD `2a8bb4c523bf8d065268ca7a1601055296abb738` was confirmed live and remains open. GitHub Actions run #353 completed successfully, including install, format, lint, typecheck, unit tests, builds, both GLB stress benchmarks, Playwright Chromium installation, and 22/22 Chromium E2E.
- Additional source review found a focus-loss edge case: negative gamepad axes survived blur/visibility release, and polling could immediately reintroduce held state before focus returned. The browser adapter now releases all non-zero values, suspends gamepad polling while blurred/hidden, and resumes it after focus/visibility restoration. A regression test covers negative-axis neutralization and disconnect/reconnect transitions.
- Supported-runtime local validation in a clean Node 22.13.0 / pnpm 12.18.0 sandbox: `pnpm check` passes (176/176 Vitest tests, format, lint, typecheck, package builds, and Editor/Player production builds); `pnpm e2e` passes 22/22 Chromium tests after installing Playwright Chromium and OS dependencies. Node 22.13.0 is within the declared Node `>=22.12.0 <23` range; pnpm 12.18.0 requires at least Node 22.13.0. These are local results, not CI for the follow-up commit.
- The preliminary Node/Rapier performance report and reproducible benchmark are recorded in `docs/PHYSICS_PERFORMANCE_REPORT.md` and `packages/engine-physics/bench/physics-performance.mjs`. Browser/device profiling, controlled memory/WASM and allocation profiling, dense-contact workloads, and owner-approved budgets remain open.
- Follow-up code and documentation are published to PR #87, including the gamepad focus fix, negative-axis regression coverage, and explicit collider/body teardown assertions. Local Node 22.13.0 / pnpm 12.18.0 validation passes `pnpm check` (176/176) and `pnpm e2e` (22/22 Chromium). GitHub Actions run #367 passed on exact code HEAD `619d4f780129adbfc52b002d98037a7f23381387`, including production builds, GLB benchmarks, and 22/22 E2E. The browser-memory repeat-import assertion now allows 20 seconds for the 2049×2049 texture decode on CI. Vercel Preview for the same SHA is READY. Keep M6 acceptance open until the remaining browser/deployment, performance, physical-device, and owner-review gates are complete.

## Next step

The minimal M6 character-controller scope is documented and its engine-owned API is implemented; Rapier slope-limit tests passed CI #343. Autostep tests were added in commit `0c548ae20eefb3c6661de8935f6a99ff82500aea` (0.4-unit step accepted under a 0.45 limit; 0.8-unit step rejected). Teardown/recreation and world-dispose/reinitialization tests were added in commit `625846e9ddaa6245ed3d7e23f4963d093fde1eda`. An actionable WASM init-failure/recovery test was added in commit `b41401dd2496c5c974eefe69ede2721125840fda`. The autostep, lifecycle, and init-recovery tests now pass in the current branch-head local suite (175/175 tests); obtain exact-head CI on Node 22.12.x before closing these gates. In parallel, verify deployment headers and supported browsers, review Rapier maintenance, and add physical gamepad coverage before producing the M6 performance report. Do not begin M7 or M10 work, reorder milestones, or mark gates complete without evidence and owner approval.
