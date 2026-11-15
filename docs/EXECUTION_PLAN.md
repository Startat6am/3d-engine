# Choreon Execution Plan

**Last updated:** 2026-11-15
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
- M6 implementation is in progress on a dedicated feature branch. Initial `@engine/input`
  and `@engine/physics` packages, fixed-tick metadata, and a focused Editor UX cleanup are
  under development. No M6 acceptance gate is claimed complete.
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
- `docs/ADR/0003-physics-backend-adapter.md` records the pinned provisional Rapier 0.21.0 package, Apache-2.0 license, Vite WASM smoke build, and remaining real-browser verification.
- `docs/ADR/0004-physics-transform-authority.md` defines conservative M6 root-body and unit-scale constraints pending integration tests.
- `docs/acceptance/M6_PHYSICS_INPUT.md` is the authoritative M6 exit checklist.
- The Editor receives a bounded visual UX cleanup as part of M6 integration; this is not the full Editor MVP and does not reorder M7–M10.
- Initial engine packages and dependencies are now present on the M6 implementation branch; the production browser smoke and full CI gates remain open.

## Next step

Complete real-browser Rapier WASM verification and the package/API conformance gates, then continue M6.2–M6.6 in order. Do not begin M7 or M10 work, reorder milestones, or mark gates complete without evidence and owner approval.
