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
- Last committed PR head before the current cancellation slice: `49af7c78602453eb64ec16b350e283ad2eb1affd`.
  The cancellation implementation is now committed in the current branch update.
- Keep PR #90 as Draft until the remaining M7 scope and owner review are complete; do not merge it
  automatically.

## Milestone status

- M2–M5: complete.
- M6 Physics/Input: functionally closed by owner direction on 2026-11-19.
- M7 World & Voxels: active; coordinates/settings, immutable chunk storage/palette validation,
  deterministic CPU meshing, stale-result validation, and cooperative AbortSignal cancellation are
  implemented. Bounded streaming is next; persistence, static collision, and Editor/Player
  integration remain pending.
- M8 Animation & Audio, M9 Editor MVP, M10 AI Authoring, M11 Runtime & Packaging, M12 Hardening: not
  started. AI authoring remains M10; do not reorder the roadmap.

## M6 implementation and accepted limitations

Implemented:

- `@engine/physics`: engine-owned PhysicsWorld API, Rapier 0.21.0 adapter, fixed-tick integration,
  rigid bodies/colliders, events, raycasts, character controller, pause/single-step, resource limits
  and opt-in bounded static-only triangle meshes.
- `@engine/input`: semantic action maps/contexts, fixed-tick snapshots, keyboard/mouse/gamepad
  adapters, transient input handling and focus/visibility/disconnect neutralization.
- Player Physics Playground with Rapier WASM, collisions, raycast, keyboard/touch movement, virtual
  joystick, jump, pause/resume, single-step and camera orbit.
- Editor UX cleanup: truthful renderer/save status, actionable empty-scene state and removal of
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

- `@engine/world` is registered in the root TypeScript project graph. It provides signed safe-integer chunk coordinates, canonical keys, floor-based world-position mapping, and validated world settings with 16³ chunk dimensions.
- `@engine/voxel` is a separate package. It provides immutable 4,096-cell Uint16 snapshots, zero-as-air and one-based palette indexes, stable material references, palette/index validation, revisioned batch edits, and inclusive changed bounds.
- CPU meshing emits deterministic exposed faces as `@engine/geometry` MeshData, split by palette material. It culls internal faces and loaded-neighbor faces, records all six neighbor revision/availability tokens, and marks missing-neighbor boundary faces provisional.
- `meshVoxelChunkAsync` adds cooperative `AbortSignal` cancellation by yielding between z-slices. Aborted jobs reject with `MESHING_ABORTED`; mutable partial geometry is never returned. The synchronous mesher remains available as the deterministic baseline.
- Cancellation tests cover synchronous/asynchronous parity, pre-aborted signals and mid-job abort. Local Node.js 22.23.5 / pnpm 12.18.0 `pnpm check` passes with 215/215 Vitest tests; Chromium E2E passes 23/23 after the cancellation change. Exact-head GitHub Actions must pass before merge.
- Not implemented yet: bounded streaming, seeded generators, persisted voxel extension/binary asset adapter, static collision generation, and Editor/Player voxel acceptance scene.
## M7 architecture decisions and next work

- [ADR 0005 — World/Voxel package boundaries](ADR/0005-world-voxel-package-boundaries.md)
- [ADR 0006 — Chunk coordinates and dimensions](ADR/0006-chunk-coordinates.md)
- [ADR 0007 — Dense cell storage and palette](ADR/0007-voxel-cell-storage.md)
- [ADR 0008 — CPU meshing and chunk borders](ADR/0008-voxel-meshing.md)
- [ADR 0009 — Bounded streaming lifecycle](ADR/0009-world-streaming.md)
- [ADR 0010 — Persistence and asset blobs](ADR/0010-voxel-serialization.md)
- [ADR 0011 — Static voxel collision](ADR/0011-voxel-static-collision.md)

Next sequence:

1. Implement bounded world streaming: request queue, concurrency/priority, cancellation propagation,
   deduplication, explicit eviction, and disposal.
2. Add deterministic seeded generator hooks and lifecycle stress tests.
3. Extract the shared project storage adapter; persist chunk descriptors and content-addressed
   payload blobs through the versioned world envelope.
4. Add static collision descriptors through public physics APIs.
5. Add a mixed voxel/conventional mesh Editor/Player acceptance scene.
6. Update this handoff, M7 plan, spec and ADRs in every implementation slice; run `pnpm check`,
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
