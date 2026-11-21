# M7 Execution Plan — World & Voxels

**Status:** ACTIVE — world/chunk core, deterministic CPU meshing, stale-result validation, cooperative cancellation, bounded scheduling, seeded generation, v1 content-addressed persistence, and Editor project persistence wiring are implemented. Player loads voxel project folders, restores primitive entities, and imports saved GLB assets through the shared importer, including node transforms, mesh primitives, PBR factors and embedded texture channels. Player integrates bounded voxel collision geometry with the public PhysicsWorld API through `createVoxelChunkColliderInputs` and `StaticMeshColliderSet`, including source/neighbor revision tokens, configured chunk origins, pre-allocation mesh budgets, replacement and page-disposal cleanup. Editor now provides a voxel editor that supports selecting chunks, painting/erasing cells by local XYZ coordinates, selecting built-in Grass/Dirt/Stone materials, and revisioned palette updates alongside conventional entities. Cross-app E2E verifies painted multi-material chunk persistence and Player mesh reconstruction; exact-head Chromium CI [#615](https://github.com/Startat6am/3d-engine/actions/runs/44824221456) passed on `7e25e4135a3b8bd9a9084a2fa11d4d0b20ef3f9c`. Viewport ray-based brush painting and hover preview are implemented. Cross-package scheduler/voxel lifecycle integration coverage is now present; browser-level streaming acceptance, migration fixtures, asset-backed material authoring and voxel benchmarks remain open. Palette entries can now be reordered with cell-index remapping or removed when unused.
**Branch:** `feat/m7-world-voxels-main`  
**Base:** `main` (M6 integrated at `54def10255ca8fad661e0077b15c3332d6a390f3`).  
**Updated:** 2026-11-22

## Goal

Deliver a bounded world/chunk layer, validated voxel representation, deterministic CPU meshing, streaming lifecycle and deterministic procedural-generation hooks. Voxel content is one geometry provider and coexists with conventional mesh entities. AI authoring remains M10; multiplayer and unbounded/infinite-world claims are excluded.

## Phase 0 — contracts and decisions

- [x] Create a separate M7 branch.
- [x] Inspect core, geometry, assets, serialization, physics, Editor project storage and subsystem contracts.
- [x] Publish `VOXEL_WORLD_SPEC.md`.
- [x] Record package boundaries, coordinates, storage/palette, meshing/borders, streaming, persistence and static-collision decisions in ADRs 0005–0011.
- [x] Extract the content-addressed project file and asset store into shared `@engine/project-storage`, retaining the Editor compatibility re-export.
- [x] Define and validate the versioned voxel chunk extension and integrate it with shared binary asset persistence before Editor/Player wiring.

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
- [x] Add repeated load/evict/dispose lifecycle stress coverage and scheduler diagnostics.
- [x] Add cross-package load/edit/mesh/evict/dispose integration coverage joining `WorldChunkScheduler`, immutable voxel snapshots, revisioned cell edits, and async CPU meshing. The test verifies mesh output, resident publication, idempotent eviction, release callbacks, disposal cleanup, and rejection after disposal. Browser-level streaming orchestration remains a separate future acceptance item.

## Phase 4 — serialization and runtime integration

The v1 persistence contract, focused storage tests, Editor directory-project persistence wiring, and Player project loader are implemented. Player opens project folders through the browser File System Access API, verifies the directory project and voxel blobs, meshes chunks with loaded-neighbor culling, restores Box/Sphere/Plane/Cylinder entities, and imports saved GLB assets through `@engine/gltf-importer`. GLB node hierarchies and TRS transforms are composed with the Editor entity transform; mesh primitives, PBR base color/metallic/roughness/alpha/emissive factors, embedded image textures, samplers and texture transforms are passed to the renderer. Cross-app Playwright acceptance now saves a textured GLB project in Editor, opens the same folder in Player, and verifies an ImageBitmap texture upload. The Editor-to-Player folder workflow was also manually confirmed on Android, with the project root (not its nested `worlds` directory) selected. External GLB image URIs, custom components and non-GLB external texture references remain unsupported; broader browser and desktop acceptance remains.

- [x] Persist chunk descriptors through the versioned world envelope extension.
- [x] Store binary cell payloads as immutable content-addressed project blobs; avoid Base64 expansion in directory projects.
- [x] Add schema and semantic validation, plus atomic-open failure coverage for malformed/missing/corrupt content.
- [ ] Add explicit migration fixtures for future extension/schema revisions.
- [x] Integrate static collision through public physics APIs and explicit mesh budgets; Player builds chunk-local meshes, validates source/neighbor revision tokens, synchronizes bounded static colliders, and disposes them with the page.
- [x] Manually verify Editor save → Player folder open on Android; the project root contains `worlds/main.world` and must be selected as the folder.
- [x] Load Editor-saved GLB assets in Player through the shared importer; restore node transforms, mesh primitives, PBR factors and embedded texture channels.
- [x] Add cross-app Playwright coverage for Editor save → Player folder open with a textured GLB and verify a browser image upload.
- [x] Complete the initial mixed voxel + conventional mesh acceptance: Editor authors/renders a voxel chunk beside a GLB entity, saves the directory project, and Player reopens it with rendered mesh parts and static voxel colliders; exact-head Chromium E2E passed in CI #612.
- [x] Add coordinate-based Editor voxel cell paint/erase with built-in material selection, automatic palette extension, immutable revisioned edits and chunk removal.
- [x] Add palette reordering with cell-index remapping and safe removal of unused palette entries.
- [ ] Pass exact-head Chromium E2E for palette reorder/removal, usage protection and cell-index remapping; coverage added, CI #631 pending.
- [x] Pass exact-head Chromium E2E for painted multi-material chunk save/reopen, verifying revision, palette and Player voxel mesh output; passed in [CI #615](https://github.com/Startat6am/3d-engine/actions/runs/44824221456) on `7e25e4135a3b8bd9a9084a2fa11d4d0b20ef3f9c`.

## Phase 5 — verification and closeout

- [x] Baseline exact-head quality gates passed in GitHub Actions [run #612](https://github.com/Startat6am/3d-engine/actions/runs/44821444780) on `2cc93543379c2c8b1ea2cbf2f6dc12c465a6bc08`: format, lint, typecheck, 257 unit/contract tests, package/app builds, both GLB benchmarks and Playwright Chromium E2E.
- [x] Local `pnpm check` passed after voxel cell editor changes: Prettier, ESLint, TypeScript, 257/257 Vitest tests and package/app builds. Local Playwright cannot launch Chromium because the sandbox lacks `libglib-2.0.so.0`; exact-head Chromium acceptance passed in CI #615.
- [x] Exact-head quality gates and Chromium E2E for the painted multi-material round-trip passed in CI #615.
- [ ] Review exact-head `voxel-world-stress-results` CI artifact and record the Node/browser/host metadata and raw voxel benchmark measurements.
- [ ] Record exact commit, CI run, Node/browser versions, chunk dimensions, voxel counts, job limits and measured resource data.
- [ ] Add viewport ray-based voxel brush interaction after coordinate-based editing and palette management are validated.
- [ ] Obtain owner acceptance of M7 scope and measured exit gates before closing M7.

## Explicit exclusions

- AI/provider integration and prompt-to-world workflows (M10).
- Multiplayer, replication and rollback.
- General-purpose node-graph procedural editor.
- Dynamic/kinematic triangle-mesh physics or implicit mesh cooking.
- GPU meshing, greedy meshing, advanced LOD, lighting bake and ambient occlusion in the initial implementation.
- Claims of infinite-world scale or fixed performance on unspecified hardware.

## Voxel persistence implementation update — 2026-11-19

- `@engine/voxel` exposes a stable v1 little-endian chunk payload codec (8192 bytes per 16³ chunk).
- `@engine/project-storage` owns `com.choreon.voxel-world` extension persistence. The extension records schema version, world voxel settings, signed chunk coordinates, revisions, palettes, and payload references with codec version, exact byte length, and SHA-256.
- Chunk blobs are immutable and content-addressed; duplicate byte-identical chunks share one blob. Save verifies every blob before writing the manifest last. Load rejects missing/corrupt blobs, unsupported versions, malformed metadata, and duplicate coordinates before returning decoded snapshots.
- Focused tests cover round-trip, invalid settings, duplicate-coordinate rejection, corruption detection, missing blobs, unsupported extension/codec versions, content deduplication, and manifest-last ordering. Editor persistence and Player folder loading/rendering are wired; GLB asset resolution and static collision are integrated in Player. Editor now supports coordinate-based cell paint/erase and built-in material palette extension. The cross-app E2E persists a painted multi-material chunk and verifies voxel mesh output in Player; exact-head Chromium CI #615 passed.
- Exact-head GitHub Actions run [#44556875444](https://github.com/Startat6am/3d-engine/actions/runs/44556875444) passed for code head `8da13169472965bfb613943a7e91d94084d3edc0`.

## Lifecycle integration update — 2026-11-22

- Added `packages/engine-voxel/src/world-lifecycle.integration.test.ts` to exercise the generic world scheduler with actual voxel snapshots, revisioned edits, and asynchronous meshing. The test covers resident publication, explicit idempotent eviction, release callback ownership, scheduler disposal, and post-disposal rejection.
- Exact-head GitHub Actions for the preceding E2E expectation corrections is running on `1ed5204678a554efd0ece3893f9e3ddba06dd6da`; do not treat it as passed until the run completes.
- A checked-in `voxel-world-v1.json` fixture now locks the current extension baseline; future-version migration fixtures remain pending until a schema revision exists. Remaining closeout work includes review of the CI voxel correctness/streaming/performance benchmark artifact, asset-backed custom material/texture authoring, browser-level streaming acceptance, and owner acceptance.
