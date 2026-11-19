# M7 Execution Plan — World & Voxels

**Status:** ACTIVE — coordinate foundation verified; Phase 0 decisions recorded; Phase 1 payload/storage is next.  
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
- [ ] Validate the persisted chunk extension and shared binary-asset adapter with integration tests before Editor/Player wiring.

## Phase 1 — world/chunk core

- [x] Add `@engine/world` and register it in the root TypeScript project graph.
- [x] Add immutable signed chunk coordinates, canonical coordinate keys and floor-based world-to-chunk mapping.
- [x] Test positive/negative positions, exact boundaries, voxel-size scaling, key round-trip and stable validation errors.
- [ ] Add validated world settings and fixed 16³ chunk configuration.
- [ ] Add immutable dense Uint16 cell snapshots, palette references and payload validation.
- [ ] Add stable error codes, edit revisions and changed-region reporting.
- [x] Initial coordinate slice: remote Node.js 22.23.5 / pnpm 12.18.0 `pnpm check` passed with 189/189 Vitest tests.
- [x] Original stacked M7 exact-head GitHub Actions run [#508](https://github.com/Startat6am/3d-engine/actions/runs/44465317676) passed the full CI workflow, including Chromium E2E. The clean main-based branch must run CI again.

## Phase 2 — CPU meshing

- [ ] Implement deterministic exposed-face meshing against immutable chunk/neighbor snapshots.
- [ ] Emit `@engine/geometry` MeshData-compatible parts; no renderer/backend imports.
- [ ] Define provisional missing-neighbor faces and invalidate on neighbor arrival/removal.
- [ ] Reject stale results by chunk and neighbor revisions; support cancellation.
- [ ] Test empty/full/checkerboard/material-boundary and adjacent-chunk fixtures, normals, winding, indices and scale.

## Phase 3 — streaming and procedural hooks

- [ ] Add a bounded request queue, concurrency/priority, cancellation, deduplication and explicit eviction.
- [ ] Add a deterministic seeded generator interface and a test generator.
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
