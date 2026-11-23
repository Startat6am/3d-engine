# Project Handoff — Choreon 3D Engine

Updated: 2026-11-23

## Current authoritative snapshot

- Repository: `Startat6am/3d-engine`; default branch: `main`.
- M6 Physics/Input is functionally closed by owner direction (2026-11-19); physical-device profiling and controlled WASM/GPU measurements remain explicitly deferred.
- M7 World & Voxels is complete and owner-accepted (2026-11-22), integrated by PR [#90](https://github.com/Startat6am/3d-engine/pull/90).
- Current M7 merge commit: [`ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`](https://github.com/Startat6am/3d-engine/commit/ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2).
- Exact-head GitHub Actions [run #45022849198](https://github.com/Startat6am/3d-engine/actions/runs/45022849198) passed.
- The previous 2026-11-21 handoff incorrectly said PR #90 was Draft and M7 active. That snapshot is stale and superseded by the merge above.
- Current M8 planning branch: `feat/m8-animation-audio-contracts`, based on `main` at the M7 merge commit.
- M8 documents: [Execution Plan](M8_EXECUTION_PLAN.md), [Animation & Audio Specification](ANIMATION_AUDIO_SPEC.md), [ADR-0013](ADR/0013-animation-audio-package-boundaries.md).

## Milestone status

- M2–M5: complete.
- M6 Physics/Input: functional scope closed; profiling limitations remain deferred.
- M7 World & Voxels: complete and owner-accepted. See the M7 implementation notes below and exact merge/CI above.
- M8 Animation & Audio: M8.0–M8.2 complete; M8.3 renderer and Player integration are active on `feat/m8-animation-audio-contracts` (Draft PR #92). The Three.js adapter consumes `RenderSkinning` through isolated geometry, `SkinnedMesh`/`Skeleton`, a bone texture and per-frame mesh-local palette updates. Player rebuilds the GLB bind pose/hierarchy, starts the first imported clip and updates palettes before rendering. Unit coverage exists for geometry attributes, palette mapping, weighted deformation and palette limits. Chromium Fox acceptance verifies visible rendering and Survey-to-Walk cross-fade; Fox-specific GPU teardown E2E is the remaining M8.3 gate. `@engine/animation` exports validated track/clip/skin data, keyframe sampling, player controls, cross-fade, defensive local-pose snapshots, hierarchy-aware skinning matrices and ECS variable-update integration. GLB importer decodes skins, inverse-bind matrices, JOINTS_0/WEIGHTS_0 and STEP/LINEAR/CUBICSPLINE translation/rotation/scale channels. The Khronos Fox fixture verifies deterministic 24-joint palette output. Exact-head CI [#45208613537](https://github.com/Startat6am/3d-engine/actions/runs/45208613537) passed on Node 22.23.5 and Chromium; the 24-joint / 48-channel benchmark recorded 13,018 evaluations/s (runner-specific, informational). Chromium visual acceptance and Player persistence remain open; audio has not started.
- M9 Editor MVP, M10 AI Authoring, M11 Runtime & Packaging, M12 Hardening: not started. AI authoring remains M10; do not reorder the roadmap.

## M8 audit findings at the main baseline

- `@engine/core` provides `EngineHost` ordered service lifecycle and ECS `SystemScheduler` phases including `fixed-update`, `variable-update` and `transform-propagation`.
- `@engine/gltf-importer` at the original M8 baseline exposed GLB meshes/materials/nodes only; the current M8 branch now adds bounded skin and animation decoding.
- `@engine/renderer` render objects accept geometry/material, transforms and optional `RenderSkinning`; the Three.js adapter now creates and updates `SkinnedMesh` objects with bounded bone textures.
- `@engine/animation` has been added on the M8 branch with validated track/clip/skin data and sampling. `@engine/audio` does not exist yet.
- Player project loading now restores GLB skinning and starts the first imported animation clip. Editor-authored animation components, persisted playback state and audio components remain unimplemented.
- Next implementation: finish M8.3 acceptance by verifying skeleton/bone-texture/geometry teardown on the Fox fixture in Chromium, then record exact-head CI. Follow `M8_EXECUTION_PLAN.md`; keep animation state renderer-independent.

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

## M7 implementation snapshot (complete)

- `@engine/world`: signed safe-integer chunk coordinates, validated settings, deterministic seeded generation context, bounded scheduler with deduplication, priority/FIFO ordering, cancellation, stale-result rejection, eviction and idempotent disposal.
- `@engine/voxel`: immutable 4,096-cell Uint16 snapshots, zero-as-air/one-based palette indexes, revisioned batch edits and deterministic CPU exposed-face meshing with neighbor revision tokens.
- `@engine/project-storage`: versioned `com.choreon.voxel-world` extension, content-addressed chunk blobs, read-back hash verification and manifest-last save.
- Editor: project persistence, chunk selection, local XYZ cell paint/erase, material palette extension/reorder/removal and dirty-state tracking.
- Player: project-folder loading, primitive and GLB restoration, voxel chunk rendering, bounded chunk-local static voxel colliders and teardown.
- Exact-head M7 acceptance is recorded in CI [#45022849198](https://github.com/Startat6am/3d-engine/actions/runs/45022849198) for merge commit `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`.
- Do not reopen M7 or add deferred greedy meshing, LOD, AO, GPU meshing, networking or dynamic voxel collision without new evidence and an explicit decision.

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

Every implementation slice must update its owning spec, M8 execution plan (for M8 work) and this handoff in the
same PR. Record exact branch/head, CI run, test totals, limitations and next task. Never invent test
counts, hardware measurements, deployment state or acceptance.

## Historical voxel persistence slice — 2026-11-19

- Added `saveVoxelWorldProject` / `loadVoxelWorldProject` in `@engine/project-storage`. V1 extension key: `com.choreon.voxel-world`; extension metadata stores voxel settings and chunk descriptors with coordinate, revision, palette, asset ID, 8192-byte length, codec version 1, and SHA-256.
- Binary chunk blobs are immutable and content-addressed under `voxel/chunks/sha256/`; identical payloads deduplicate. Save verifies blob read-back before writing `worlds/main.world` last. Load validates metadata, duplicate coordinates, codec version, byte length, hash, and voxel palette/cell indexes.
- Focused storage tests: round-trip, invalid settings, duplicate coordinate rejection, unsupported extension/codec versions, missing/corrupted blobs, deduplication, and manifest-last ordering.
- Local `pnpm check`, `pnpm e2e`, and `git diff --check` pass for this slice. Exact-head GitHub Actions run [#44557891533](https://github.com/Startat6am/3d-engine/actions/runs/44557891533) passed on code head `62a6c79d4bdc39fca0a568e1cae3ddc1aeb9ce75`.
- PR #90 remains Draft and must not be merged automatically.
