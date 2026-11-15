# Choreon Execution Plan

**Last updated:** 2026-11-15
**Repository:** `Startat6am/3d-engine`
**Current milestone:** M5 — Assets & Serialization (complete)
**Next milestone:** M6 — Physics & Input (planning only)

This file is the current handoff point. Older stacked-PR notes have been superseded
by the M5 closeout recorded below. Historical implementation details remain in GitHub
PRs and `ASSETS_SERIALIZATION_STATUS.md`.

## Current state

- M2 Foundation, M3 Core & ECS, and M4 Geometry & renderer baseline are complete.
- M5 exit gates are complete: import/serialization/PBR/lifecycle checks, directory-project
  save/reopen, tampered-blob rollback, missing-blob rollback, and exact-head Previews.
- M5 does not claim a whole-tab/process memory ceiling or a physical GPU-VRAM budget.
- The next roadmap milestone is M6 Physics & Input. Do not accelerate the AI-authoring
  milestone or change the agreed milestone order.

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

## Next step

Plan M6 Physics & Input against the existing subsystem contracts before implementation.
Do not begin M10 AI authoring work or reorder milestones without explicit approval.
