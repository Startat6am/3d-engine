# Project Handoff — Choreon 3D Engine

Updated: 2026-11-19

## Current authoritative snapshot

- Repository: `Startat6am/3d-engine`; default branch: `main`.
- M6 is integrated in `main` through squash merge `54def10255ca8fad661e0077b15c3332d6a390f3` (PR
  #87).
- M6 functional implementation is closed. Exact-head GitHub Actions [run
  #506](https://github.com/Startat6am/3d-engine/actions/runs/44465087886) passed.
- M7 is being developed in draft PR [#90](https://github.com/Startat6am/3d-engine/pull/90)
  on `feat/m7-world-voxels-main`, based directly on the M6 merge commit above.
- Latest PR head before the current voxel persistence slice:
  `ebabe4d0e06388fbef758d2c6f49cfe3f707e115`; CI for that exact head failed only at
  `prettier --check` on the voxel codec files (formatting fix included in the follow-up).
  Cancellation, bounded streaming and seeded generation are included in PR #90; exact-head CI remains the merge gate.
- Keep PR #90 as Draft until the remaining M7 scope and owner review are complete; do not merge it
  automatically.

## Milestone status

- M2–M5: complete.
- M6 Physics/Input: functionally closed by owner direction on 2026-11-19.
- M7 World & Voxels: active; coordinates/settings, immutable chunk storage/palette validation,
  deterministic CPU meshing, stale-result validation, cooperative AbortSignal cancellation, and a
  bounded chunk scheduler, deterministic seeded generation, and repeated load/eviction lifecycle stress
  coverage are implemented. The content-addressed project storage adapter and v1
  `com.choreon.voxel-world` persistence are implemented in `@engine/project-storage`; Editor/Player
  integration and broader persistence/CI coverage remain pending.
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
- Local Node.js 22.23.5 / pnpm 12.18.0 `pnpm check` passes with 230/230 Vitest tests; Chromium E2E passes 23/23 after the shared project-storage extraction. Exact-head GitHub Actions remains the merge gate; latest completed PR head `f5ee5d9` passed.
- Not implemented yet: repeated end-to-end lifecycle stress coverage, persisted voxel extension/binary asset adapter, static collision generation and Editor/Player voxel acceptance scene.

Next sequence:

1. Add repeated load/edit/mesh/evict/dispose lifecycle stress tests and diagnostics.
2. Extract the shared project storage adapter; persist chunk descriptors and content-addressed
   payload blobs through the versioned world envelope.
3. Add static collision descriptors through public physics APIs.
4. Add a mixed voxel/conventional mesh Editor/Player acceptance scene.
5. Update this handoff, M7 plan, spec and ADRs in every implementation slice; run `pnpm check`,
   `pnpm e2e`, and exact-head GitHub Actions.

Do not add workers before main-thread contracts are correct. Do not add greedy meshing, LOD, AO, GPU
meshing, AI authoring, networking or dynamic voxel collision without a new decision and evidence.

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
- Focused storage tests: round-trip, duplicate coordinate rejection, unsupported codec version, missing blob, corrupted blob, deduplication, and manifest-last ordering.
- Local `pnpm check`, `pnpm e2e`, and `git diff --check` pass for this slice. Exact-head CI for `ebabe4d` failed on Prettier formatting; the formatted fix is included in this follow-up.
- PR #90 remains Draft and must not be merged automatically.
