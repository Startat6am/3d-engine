# Project Handoff — Choreon 3D Engine

Updated: 2026-11-22

## Current authoritative snapshot

- Repository: `Startat6am/3d-engine`; default branch: `main`.
- M6 is integrated in `main` through squash merge `54def10255ca8fad661e0077b15c3332d6a390f3` (PR #87).
- M7 World & Voxels was explicitly accepted by the owner on 2026-11-22 after exact-head CI and Android smoke validation. PR [#90](https://github.com/Startat6am/3d-engine/pull/90) was squash-merged as `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`.
- M8 Animation & Audio is active on branch `feat/m8-animation-audio`, based directly on the M7 merge commit above.
- M8 normative contract: [Animation & Audio Specification](ANIMATION_AUDIO_SPEC.md). Sequencing/evidence: [M8 Execution Plan](M8_EXECUTION_PLAN.md). Architecture decision: [ADR 0013](ADR/0013-animation-audio-package-boundaries.md).
- Latest M7 exact-head CI: [run #45022849198](https://github.com/Startat6am/3d-engine/actions/runs/45022849198), passed on `ae64a2b05a9c6fbf9e8f244e0be7850c8682438a`. Local verification: 283/283 Vitest tests, full Chromium Playwright suite, format, lint, typecheck and production builds.
- Owner confirmed Player and Editor work on the target Android device. This is a smoke check, not detailed GPU/memory profiling.

## Milestone status

- M2–M5: complete.
- M6 Physics/Input: functional scope closed by owner direction on 2026-11-19; physical profiling remains deferred.
- M7 World & Voxels: complete and merged; owner acceptance recorded 2026-11-22.
- M8 Animation & Audio: started; contract baseline and package boundaries documented, implementation not yet complete.
- M9 Editor MVP, M10 AI Authoring, M11 Runtime & Packaging, M12 Hardening: not started. AI authoring remains M10; do not reorder the roadmap.

## M8 current implementation

- `@engine/animation` now exports validated clip/track contracts, STEP/LINEAR/CUBICSPLINE samplers, shortest-path quaternion slerp and normalization, pose blending, playback controls, looping/seek and cross-fade state.
- `@engine/audio` now exports backend-neutral clip/voice/listener contracts, explicit user-gesture activation, deduplicated clip decoding, validated source/listener updates, inverse-distance attenuation, bounded voice count (default 32), encoded clip size (64 MiB) and decoded duration (600 seconds), and idempotent teardown. It does not yet contain a Web Audio implementation.
- Focused tests: 10 animation + 6 audio; full workspace: format, lint, typecheck, 299/299 Vitest tests and production builds passed on the current local workspace.
- GLB skin/animation import, renderer skinning, Web Audio backend and Player acceptance scene are not yet implemented.

## M8 immediate next steps

1. Extend GLB importer with skins, inverse-bind matrices and animation samplers/channels, including malformed fixture coverage.
2. Implement CPU skinning palette calculation and validate matrix order.
3. Add skinned render inputs and renderer-owned GPU skinning resources.
4. Implement Web Audio decode/voice backend and Chromium lifecycle tests.
5. Build Player animated-character/spatial-audio acceptance scene; keep roadmap, plan, spec and handoff synchronized.

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
- Editor directory-project persistence carries voxel settings/chunk snapshots through project open/save and refuses standalone `.world` export when external voxel blobs would be lost. The Editor Hierarchy selects voxel chunks; the Inspector edits local cell coordinates, paints or erases cells, selects built-in Grass/Dirt/Stone materials, appends missing palette entries and displays the current revision/palette. Palette entries can be reordered with cell-index remapping or removed only when unused. Each edit creates a new immutable snapshot and marks the project dirty. Chunk deletion is supported. E2E for palette remapping/removal is added and awaiting exact-head CI #631.
- Player now exposes an `Open project folder` action backed by `BrowserProjectFileStore` and `loadVoxelWorldProject`. It verifies project assets/chunk blobs before replacing the sample scene, renders voxel chunks through `meshVoxelChunk` with loaded-neighbor face culling, maps built-in palette keys to preview colors, restores Box/Sphere/Plane/Cylinder `MeshRenderer` entities, and frames the loaded content.
- Player restores Box/Sphere/Plane/Cylinder entities and imported GLB node hierarchies, mesh primitives, PBR factors and embedded texture channels. External GLB image URIs, custom components and non-GLB external texture references remain unsupported. Folder selection requires the browser File System Access API (Chromium-based browser, secure context).
- Player builds bounded chunk-local static voxel colliders through the public PhysicsWorld API, tracks source and neighbor revisions, synchronizes replacements/unloads through `StaticMeshColliderSet`, and disposes handles on page teardown. The Editor→Player E2E creates a voxel chunk beside an imported GLB, verifies binary chunk persistence, reopens the project in Player, and asserts rendered mesh parts plus static voxel colliders; exact-head Chromium acceptance passed in CI #612.
- Exact-head GitHub Actions [run #612](https://github.com/Startat6am/3d-engine/actions/runs/44821444780) passed on `2cc93543379c2c8b1ea2cbf2f6dc12c465a6bc08`: format, lint, typecheck, 257 unit/contract tests, package/app builds, GLB geometry and embedded-image benchmarks, and Chromium E2E. After that head, coordinate-based voxel paint/erase and multi-material round-trip assertions were added. Local `pnpm check` passes with 257/257 tests and both app builds; local Playwright cannot launch Chromium because this sandbox lacks `libglib-2.0.so.0`. Exact-head Chromium CI [#615](https://github.com/Startat6am/3d-engine/actions/runs/44824221456) passed on `7e25e4135a3b8bd9a9084a2fa11d4d0b20ef3f9c`, including the painted multi-material save/reopen E2E.

M7 was accepted and merged. Deferred follow-ups are recorded rather than treated as blockers: future persisted-schema migration fixtures, additional long-run/browser/device profiling, and any unimplemented authoring/meshing enhancements. Do not add workers, greedy meshing, LOD, AO, GPU meshing, AI authoring, networking or dynamic voxel collision without a new decision and evidence.

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

Every implementation slice must update its owning spec, owning subsystem specification, milestone execution plan, roadmap and this handoff in the
same PR. Record exact branch/head, CI run, test totals, limitations and next task. Never invent test
counts, hardware measurements, deployment state or acceptance.

## Voxel persistence slice — 2026-11-19

- Added `saveVoxelWorldProject` / `loadVoxelWorldProject` in `@engine/project-storage`. V1 extension key: `com.choreon.voxel-world`; extension metadata stores voxel settings and chunk descriptors with coordinate, revision, palette, asset ID, 8192-byte length, codec version 1, and SHA-256.
- Binary chunk blobs are immutable and content-addressed under `voxel/chunks/sha256/`; identical payloads deduplicate. Save verifies blob read-back before writing `worlds/main.world` last. Load validates metadata, duplicate coordinates, codec version, byte length, hash, and voxel palette/cell indexes.
- Focused storage tests: round-trip, invalid settings, duplicate coordinate rejection, unsupported extension/codec versions, missing/corrupted blobs, deduplication, and manifest-last ordering.
- Local `pnpm check`, `pnpm e2e`, and `git diff --check` pass for this slice. Exact-head GitHub Actions run [#44557891533](https://github.com/Startat6am/3d-engine/actions/runs/44557891533) passed on code head `62a6c79d4bdc39fca0a568e1cae3ddc1aeb9ce75`.
- PR #90 remains Draft and must not be merged automatically.
