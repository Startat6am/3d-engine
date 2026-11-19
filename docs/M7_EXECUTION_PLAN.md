# M7 Execution Plan — World & Voxels

**Status:** ACTIVE — world/chunk core, deterministic CPU meshing, stale-result validation, cooperative meshing cancellation, and the bounded chunk scheduler and deterministic seeded generator hooks are implemented; repeated load/eviction lifecycle stress coverage and the shared `@engine/project-storage` package extraction are implemented; voxel extension serialization and integration tests are next.
**Branch:** `feat/m7-world-voxels-main`  
**Base:** `main` (M6 integrated at `54def10255ca8fad661e0077b15c3332d6a390f3`).  
**Updated:** 2026-11-19

## Goal

Deliver a bounded world/chunk layer, validated voxel representation, deterministic CPU meshing, streaming lifecycle and deterministic procedural-generation hooks. Voxel content is one geometry provider and coexists with conventional mesh entities. AI authoring remains M10; multiplayer and unbounded/infinite-world claims are excluded.

## Phase 0 — contracts and decisions

- [x] Create a separate M7 branch.
- [x] Inspect core, geometry, assets, serialization, physics, Editor project storage and subsystem contracts.
- [x] Publish `VOXEL_WORLD_SPEC.md`.
- [x] Record package boundaries, coordinates, storage/palette, meshing/borders, streaming, persistence and static-collision decisions in ADRs 0005–0011.
- [x] Extract the content-addressed project file and asset store into shared `@engine/project-storage`, retaining the Editor compatibility re-export.
- [ ] Define and validate the versioned voxel chunk extension and integrate it with shared binary asset persistence before Editor/Player wiring.

## Phase 1 — world/chunk core

- [x] Add `@engine/world` and register it in the root TypeScript project graph.
- [x] Add immutable signed chunk coordinates, canonical coordinate keys and floor-based world-to-chunk mapping.
- [x] Test positive/negative positions, exact boundaries, voxel-size scaling, key round-trip and stable validation errors.
- [x] Add validated world settings and fixed 16³ chunk configuration.
- [x] Add immutable dense Uint16 cell snapshots, palette references and payload validation.
- [x] Add stable error codes, edit revisions and changed-region reporting.
- [x] Local Node.js 22.23.5 / pnpm 12.18.0 `pnpm check` passed with 230/230 Vitest tests after the shared project-storage extraction; Chromium E2E passed 23/23. Exact-head CI for this M7 slice is required before merge.
- [x] Original stacked M7 exact-head GitHub Actions run [#508](https://github.com/Startat6am/3d-engine/actions/runs/44465317676) passed the full CI workflow, including Chromium E2E. The clean main-based branch must run CI again.

## Phase 2 — CPU meshing

- [x] Implement deterministic exposed-face meshing against immutable chunk/neighbor snapshots.
- [x] Emit `@engine/geometry` MeshData-compatible parts; no renderer/backend imports.
- [x] Define provisional missing-neighbor faces and record neighbor revision/availability tokens.
- [x] Reject stale mesh results when source or neighbor revisions/availability change.
- [x] Add cooperative async meshing with `AbortSignal`; cancellation rejects without exposing partial geometry.
- [x] Test empty/full, material boundaries, adjacent cells/chunks, normals, winding, indices and scale.

## Phase 3 — streaming and procedural hooks

- [x] Add a bounded request queue, concurrency/priority, cancellation propagation, deduplication, explicit eviction and disposal; require caller-supplied resident/payload limits.
- [x] Add a deterministic seeded generator context/PRNG hook and deterministic test generator.
- [ ] Keep main-thread execution as the correctness baseline; add workers only after contract parity tests.
- [ ] Add repeated load/edit/mesh/evict/dispose tests and diagnostics.

## Phase 4 — serialization and runtime integration

- [ ] Persist chunk descriptors through the versioned world envelope extension.
- [ ] Store binary cell payloads as immutable content-addressed project blobs; avoid Base64 expansion in directory projects.
- [ ] Add schema, semantic validation, migration fixtures and atomic-open failure coverage.
- [ ] Integrate static collision through public physics APIs and explicit mesh budgets.
- [ ] Add a mixed voxel + conventional mesh acceptance world in Player and Editor.

## Phase 5 — verification and closeout

- [ ] Run format, lint, typecheck, unit/contract tests, package/app builds, GLB benchmarks and Playwright Chromium E2E.
- [ ] Add voxel correctness, streaming, lifecycle and performance benchmarks with raw output.
- [ ] Record exact commit, CI run, Node/browser versions, chunk dimensions, voxel counts, job limits and measured resource data.
- [ ] Obtain owner acceptance of M7 scope and measured exit gates before closing M7.

## Explicit exclusions

- AI/provider integration and prompt-to-world workflows (M10).
- Multiplayer, replication and rollback.
- General-purpose node-graph procedural editor.
- Dynamic/kinematic triangle-mesh physics or implicit mesh cooking.
- GPU meshing, greedy meshing, advanced LOD, lighting bake and ambient occlusion in the initial implementation.
- Claims of infinite-world scale or fixed performance on unspecified hardware.
