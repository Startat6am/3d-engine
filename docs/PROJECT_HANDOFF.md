# Project Handoff — Choreon 3D Engine

Updated: 2026-11-21

## Current authoritative snapshot

- Repository: `Startat6am/3d-engine`; default branch: `main`.
- M6 is integrated in `main` through squash merge `54def10255ca8fad661e0077b15c3332d6a390f3` (PR
  #87).
- M6 functional implementation is closed. Exact-head GitHub Actions [run
  #506](https://github.com/Startat6am/3d-engine/actions/runs/44465087886) passed.
- M7 is being developed in draft PR [#90](https://github.com/Startat6am/3d-engine/pull/90)
  on `feat/m7-world-voxels-main`, based directly on the M6 merge commit above.
- Player project-folder loading, GLB restoration, and bounded static voxel collider integration are present on the current M7 head. Exact-head CI remains the merge gate.
- Keep PR #90 as Draft until the remaining M7 scope and owner review are complete; do not merge it
  automatically.

## Milestone status

- M2–M5: complete.
- M6 Physics/Input: functionally closed by owner direction on 2026-11-19.
- M7 World & Voxels: active; coordinates/settings, immutable chunk storage/palette validation,
  deterministic CPU meshing, stale-result validation, cooperative AbortSignal cancellation, and a
  bounded chunk scheduler, deterministic seeded generation, repeated load/eviction lifecycle stress
  coverage, content-addressed v1 `com.choreon.voxel-world` persistence, and Editor project persistence
  wiring are implemented. Player opens project folders, verifies voxel blobs, renders voxel chunks,
  restores primitive and GLB entities, and builds bounded static voxel colliders through PhysicsWorld.
  Editor supports chunk selection, local XYZ cell painting/erasing, built-in Grass/Dirt/Stone
  material selection and revisioned palette extension. Painted multi-material save/reopen E2E coverage
  has been added; exact-head CI for this authoring slice is pending. Viewport brush interaction, palette
  management, migration fixtures, lifecycle coverage and voxel benchmarks remain.
- M8 Animation & Audio, M9 Editor MVP, M10 AI Authoring, M11 Runtime & Packaging, M12 Hardening: not
  started. AI authoring remains M10; do not reorder the roadmap.

## M6 implementation and accepted limitations

Implemented:

- `@engine/physics`: engine-owned PhysicsWorld API, Rapier 0.21.0 adapter, fixed-tick integration,
  rigid bodies/colliders, events, raycasts, character controller, pause/single-step, resource limits
  and opt-in bounded static-only triangle meshes.
- `@engine/input`: semantic action maps/contexts, fixed-tick snapshots, keyboard/mouse/gamepad
  adapters, transient input handling and focus/visibility/disconnect neutralization.
- Pl...[truncated]- Editor UX cleanup: truthful renderer/save status, actionable empty-scene state and removal of
  decorative/non-functional placeholders.
- M6 contracts, ADRs, acceptance criteria, performance report and real-device profiling worksheet.

Verification:

- GitHub Actions run #506 passed on exact M6 PR head `44689fb4cbe1ed38fb53842b18d193abd9bf8b2e`:
  install, Prettier, ESLint, TypeScript, Vitest, package/app builds, GLB stress benchmarks and
  Playwright Chromium E2E.
- Owner reviewed the deployed Player/Physics Playground in normal Chrome on 2026-11-19 and reported
  no issues.

Explicitly deferred; do not describe as passed:

- Physical desktop/target-device profiling.
- Controlled WASM-memory/allocation and GPU/frame-time profiling; numeric performance budgets.
- Physical gamepad verification.
- Dynamic/kinematic triangle meshes and automatic mesh cooking.
- Firefox/WebKit and real mobile-browser compatibility. M6 browser acceptance is Chromium;
  mobile-sized Chromium touch checks are responsive/input coverage only.

## M7 current implementation

- `@engine/world` provides signed safe-integer chunk coordinates, canonical keys, floor-based world-position mapping, validated world settings and a bounded `WorldChunkScheduler<T>`.
- The scheduler bounds concurrent jobs, queued jobs, resident chunks and per-chunk payload bytes; it deduplicates coordinate/revision requests, orders by priority with FIFO ties, propagates AbortSignal, rejects stale completions, enforces explicit eviction and disposes idempotently.
- `createChunkGenerationContext` supplies a deterministic PRNG scoped to a validated world seed and signed chunk coordinate, plus the request AbortSignal.
- `@engine/voxel` provides immutable 4,096-cell Uint16 snapshots, zero-as-air and one-based palette indexes, stable material references, palette/index validation, revisioned batch edits and inclusive changed bounds.
- CPU meshing emits deterministic exposed faces as `@engine/geometry` MeshData, split by palette material. It culls internal and loaded-neighbor faces, records six neighbor revision/availability tokens and marks missing-neighbor boundary faces provisional.
- `meshVoxelChunkAsync` cooperatively yields between z-slices, observes `AbortSignal` and rejects with `MESHING_ABORTED`; partial geometry is never returned. The synchronous mesher remains the deterministic baseline.
- Repeated load/evict/dispose lifecycle coverage is present in `packages/engine-world/src/streaming.test.ts`; the test keeps resident bounds enforced across repeated cycles.
- `@engine/project-storage` owns the versioned `com.choreon.voxel-world` extension and content-addressed binary chunk blobs. Save verifies payload read-back and writes the manifest last; load validates extension/codec versions, exact payload length, SHA-256, coordinates, palette and cell indexes before returning snapshots.
- Focused persistence tests cover round-trip, invalid settings, duplicate coordinates, unsupported versions, missing/corrupted blobs, content deduplication and manifest-last ordering.
- Editor directory-project persistence carries voxel settings/chunk snapshots through project open/save and refuses standalone `.world` export when external voxel blobs would be lost. The Editor Hierarchy selects voxel chunks; the Inspector edits local cell coordinates, paints or erases cells, selects built-in Grass/Dirt/Stone materials, appends missing palette entries and displays the current revision/palette. Each successful cell edit creates a new immutable snapshot and marks the project dirty. Chunk deletion is supported.
- Player now exposes an `Open project folder` action backed by `BrowserProjectFileStore` and `loadVoxelWorldProject`. It verifies project assets/chunk blobs before replacing the sample scene, renders voxel chunks through `meshVoxelChunk` with loaded-neighbor face culling, maps built-in palette keys to preview colors, restores Box/Sphere/Plane/Cylinder `MeshRenderer` entities, and frames the loaded content.
- Player restores Box/Sphere/Plane/Cylinder entities and imported GLB node hierarchies, mesh primitives, PBR factors and embedded texture channels. External GLB image URIs, custom components and non-GLB external texture references remain unsupported. Folder selection requires the browser File System Access API (Chromium-based browser, secure context).
- Player builds bounded chunk-local static voxel colliders through the public PhysicsWorld API, tracks source and neighbor revisions, synchronizes replacements/unloads through `StaticMeshColliderSet`, and disposes handles on page teardown. The Editor→Player E2E creates a voxel chunk beside an imported GLB, verifies binary chunk persistence, reopens the project in Player, and asserts rendered mesh parts plus static voxel colliders; exact-head Chromium acceptance passed in CI #612.
- Exact-head GitHub Actions [run #612](https://github.com/Startat6am/3d-engine/actions/runs/44821444780) passed on `2cc93543379c2c8b1ea2cbf2f6dc12c465a6bc08`: format, lint, typecheck, 257 unit/contract tests, package/app builds, GLB geometry and embedded-image benchmarks, and Chromium E2E. After that head, coordinate-based voxel paint/erase and multi-material round-trip assertions were added. Local `pnpm check` passes with 257/257 tests and both app builds; local Playwright cannot launch Chromium because this sandbox lacks `libglib-2.0.so.0`. The new exact-head CI run is pending.

Next sequence:

1. Pass exact-head Chromium E2E for painted multi-material chunk save/reopen and Player mesh reconstruction; coverage is added but pending CI.
2. Add viewport ray-based painting plus palette removal/reordering and richer authoring controls.
3. Add migration fixtures and full load/edit/mesh/evict/dispose pipeline coverage.
4. Run voxel correctness/streaming/performance benchmarks and record exact commit, CI run, Node/browser versions, chunk dimensions, voxel counts, job limits and measured resource data.
5. Obtain owner acceptance of the measured M7 exit gates before closing the milestone.

Do not add workers before main-thread contracts are correct. Do not add greedy meshing, LOD, AO, GPU meshing, AI authoring, networking or dynamic voxel collision without a new decision and evidence.

## Quality gates

Requirements: Node.js 22.12+ and pnpm 12.18.0.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Every implementation slice must update its owning spec, M7 execution plan and this handoff in the
same PR. Record exact branch/head, CI run, test totals, limitations and next task. Never invent test
counts, hardware measurements, deployment state or acceptance.

## Voxel persistence slice — 2026-11-19

- Added `saveVoxelWorldProject` / `loadVoxelWorldProject` in `@engine/project-storage`. V1 extension key: `com.choreon.voxel-world`; extension metadata stores voxel settings and chunk descriptors with coordinate, revision, palette, asset ID, 8192-byte length, codec version 1, and SHA-256.
- Binary chunk blobs are immutable and content-addressed under `voxel/chunks/sha256/`; identical payloads deduplicate. Save verifies blob read-back before writing `worlds/main.world` last. Load validates metadata, duplicate coordinates, codec version, byte length, hash, and voxel palette/cell indexes.
- Focused storage tests: round-trip, invalid settings, duplicate coordinate rejection, unsupported extension/codec versions, missing/corrupted blobs, deduplication, and manifest-last ordering.
- Local `pnpm check`, `pnpm e2e`, and `git diff --check` pass for this slice. Exact-head GitHub Actions run [#44557891533](https://github.com/Startat6am/3d-engine/actions/runs/44557891533) passed on code head `62a6c79d4bdc39fca0a568e1cae3ddc1aeb9ce75`.
- PR #90 remains Draft and must not be merged automatically.
