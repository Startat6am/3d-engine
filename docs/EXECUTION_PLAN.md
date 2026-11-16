# Choreon Execution Plan

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
- Revalidated the updated branch in a clean Node 25 sandbox: pnpm check passed (format, lint, typecheck, production builds, and 144 unit tests). The local E2E attempt enumerated all 22 tests, but Chromium could not start because this sandbox lacks the system shared library libglib-2.0.so.0; no E2E test body ran. The submitted PR #87 head separately reported 22/22 Chromium E2E passing before the latest commits; CI must be rerun on the updated exact head. The repository's declared supported Node range remains 22.12.x.
- PR #87 `pnpm e2e`: 22 Playwright Chromium tests passed, including editor/mobile, asset serialization, renderer lifecycle, and memory benchmark coverage.
- Dedicated Rapier browser smoke: WASM loaded, a dynamic body completed 60 fixed steps (Y=0.07456), and raycast returned a hit.
- Production Vite smoke emitted a separate ~1.17 MB WASM asset (~0.45 MB gzip) and a ~52 KB gzip lazy JS chunk.
- Player Physics Playground: five-body gravity/collision scene, keyboard movement, raycast, pause/resume, and single-step; Playwright also checks the 360px layout.
- Resource limits are now implemented and covered: live body/collider counts, collision events per drain, ray distance, and convex-hull vertex count. Defaults are documented and overridable per world.
- Shared Fake/Rapier PhysicsWorld conformance suite: 10/10 tests pass across lifecycle, pose operations, stale handles, collider ownership, pause/single-step, empty query/event behavior, and disposal.
- Still open: deployment-header/target-browser checks, Rapier maintenance review, physical gamepad E2E, character controller, collision-exit/filter edge coverage, physics performance report, and owner M6 sign-off.

## Next step

Next, expand adapter conformance to cover collision enter/exit/filter and ray query semantics, close collision-exit/filter edge cases, and implement the character controller. In parallel, verify deployment headers and supported browsers, review Rapier maintenance, and add physical gamepad coverage before producing the M6 performance report. Do not begin M7 or M10 work, reorder milestones, or mark gates complete without evidence and owner approval.
