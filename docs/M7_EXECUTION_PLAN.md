# M7 Execution Plan — World & Voxels

**Status:** STARTED — contract and architecture phase.
**Branch:** feat/m7-world-voxels
**Base:** feat/m6-physics-input-core (stacked until M6 PR #87 is integrated).
**Updated:** 2026-11-19

## Goal

Deliver the roadmap's M7 world/voxel foundation: chunk model, bounded meshing, streaming lifecycle, and deterministic procedural-generation hooks. Voxel content remains one geometry provider and coexists with conventional mesh entities. This milestone excludes AI authoring (M10), networked multiplayer, and unbounded/infinite-world promises.

## Starting repository state

- M2–M5 are recorded complete.
- M6 functional scope is closed by owner direction and documented on the parent branch. Physical-device profiling, controlled WASM-memory/allocation measurements, GPU/frame-time profiling, and physical gamepad checks remain explicitly deferred.
- M6 PR #87 remains separate integration work. This branch is based on its current branch head to use the physics/input APIs; do not merge M7 into PR #87.
- Existing packages include engine-core, engine-geometry, engine-renderer, engine-assets, engine-serialization, engine-physics, and engine-input. There is no engine-world or voxel package in the package workspace at M7 start.
- Existing world serialization is versioned; project-directory storage uses immutable content-addressed blobs and manifest-last commit semantics.
- Existing geometry is CPU-side MeshData; renderer is backend-isolated; physics exposes collider descriptors. M7 integrates through these public contracts.

## Phase 0 — contract and decisions (current)

- [x] Create a separate M7 work branch.
- [x] Inspect architecture, subsystem-contract requirements, geometry, asset, serialization, physics, and roadmap docs.
- [x] Draft the world/voxel subsystem contract in docs/VOXEL_WORLD_SPEC.md.
- [ ] Review the contract against current package exports and actual serializer/asset-store APIs.
- [ ] Add ADRs for package split, coordinates/chunk dimensions, cell storage/palette, meshing/borders, streaming/jobs/eviction, serialization, and static collision policy.
- [ ] Define machine-readable persisted chunk schema and stable error categories before implementation.

## Phase 1 — world/chunk core

- [x] Add the initial @engine/world package scaffold and register it in the TypeScript project graph.
- [x] Add immutable signed chunk-coordinate values, stable coordinate keys, and world-position-to-chunk/local-cell conversion.
- [x] Add unit fixtures for positive/negative positions, exact boundaries, explicit voxel scale, key round-trip, and stable validation errors.
- [ ] Add world settings, chunk lifecycle, and bounded job interfaces after their ADRs.
- [ ] Add voxel payload validation and the cell/palette contract.
- [x] Remote Node 22.23.5 / pnpm 12.18.0 `pnpm check`: format, lint, typecheck, package/app builds, and 189/189 Vitest tests passed.
- [ ] Run exact-head GitHub Actions CI and Chromium E2E; local Playwright was blocked by missing `libglib-2.0.so.0` in the remote box image.

## Phase 2 — CPU meshing

- [ ] Implement the agreed baseline mesher against immutable chunk/neighbor snapshots.
- [ ] Emit geometry compatible with @engine/geometry; keep renderer backend types out.
- [ ] Handle chunk-border arrival/removal, revision invalidation, cancellation, and stale results.
- [ ] Add fixtures for empty/full/checkerboard/material-boundary and adjacent chunks.

## Phase 3 — streaming and procedural hooks

- [ ] Add bounded request queue, concurrency/priority, cancellation, deduplication, and explicit eviction.
- [ ] Add deterministic seeded generator interface and a test/example generator.
- [ ] Add worker adapter only if the same contract is validated on main thread and in worker mode; workers are not required for correctness.
- [ ] Add repeated load/edit/mesh/evict/dispose tests and resource diagnostics.

## Phase 4 — serialization and runtime integration

- [ ] Persist voxel/chunk data through the existing world envelope and project asset-store contract.
- [ ] Add schema/migration/semantic validation fixtures and atomic-open failure coverage.
- [ ] Integrate static collision only through public physics APIs and explicit budgets.
- [ ] Add a mixed voxel + conventional mesh acceptance world in Player and Editor.

## Phase 5 — verification and closeout

- [ ] Run format, lint, typecheck, unit/contract tests, package/app builds, GLB stress benchmarks, and Playwright Chromium E2E.
- [ ] Add voxel-specific correctness, streaming, lifecycle, and performance benchmarks with raw output.
- [ ] Record exact-head CI, deployment URL/revision, browser verification, limitations, and resource measurements.
- [ ] Obtain owner acceptance of the M7 scope and measured exit gates before marking M7 complete.

## Explicit exclusions

- AI/provider integration and prompt-to-world workflows (M10).
- Multiplayer/replication/rollback.
- General-purpose node-graph procedural editor.
- Dynamic/kinematic triangle-mesh physics or implicit mesh cooking.
- GPU meshing, advanced LOD, lighting bake, and ambient occlusion unless separately approved by evidence.
- Claims of infinite-world scale or fixed performance on unspecified hardware.

## Parent CI caveat

The parent M6 head 6d094e495be7e1c23c4cf5c1619c6a708a87d081 has failed documentation-head CI run #495: pnpm format:check reports five M6 documentation files as not Prettier-formatted. Lint, typecheck, tests, builds, and E2E were skipped by workflow dependency ordering. This is an integration/formatting issue, not evidence of an M7 code failure. Resolve it on the parent M6 branch and re-run exact-head CI before merging the stack.
