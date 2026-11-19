# Project Handoff — Choreon 3D Engine

Updated: 2026-11-19

## Current authoritative snapshot

- Repository: `Startat6am/3d-engine`; default branch: `main`.
- M6 is integrated in `main` through squash merge `54def10255ca8fad661e0077b15c3332d6a390f3` (PR
  #87).
- M6 functional implementation is closed. Exact-head GitHub Actions [run
  #506](https://github.com/Startat6am/3d-engine/actions/runs/44465087886) passed.
- M7 World & Voxels is active. The initial `@engine/world` coordinate foundation passed exact-head
  GitHub Actions [run #508](https://github.com/Startat6am/3d-engine/actions/runs/44465317676) on the
  original stacked head `99c2de59696f706672588b9ccd0e1c050ce921e3`. A clean M7 branch based directly
  on the new `main` is being prepared because M6 was squash-merged.
- PR #86 is redundant: its M6 planning docs are included in PR #87's merged tree. Close it as
  superseded.
- PR #88 (desktop camera controls) remains separate and must be reviewed/rebased independently; it
  was based on an earlier M6 commit and diverged.
- PR #89 is the original stacked M7 draft. Do not merge it against the new `main`; replace it with a
  main-based M7 PR.

## Milestone status

- M2–M5: complete.
- M6 Physics/Input: functionally closed by owner direction on 2026-11-19.
- M7 World & Voxels: active; chunk-coordinate foundation implemented; payload storage/palette is
  next.
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
- Tests cover coordinates/settings, immutable storage, palette validation, edit revisions, empty/full chunks, material splits, adjacent cells/chunks, normals/winding, scaling, provisional borders and invalid neighbors. The Physics Playground touch-distance assertion now allows one additional fixed tick of browser scheduling jitter; targeted and full Chromium E2E both pass.
- Local Node.js 22.23.5 / pnpm 12.18.0 `pnpm check` passed with 210/210 Vitest tests; Chromium E2E passed 23/23 on the final meshing head. Exact-head GitHub Actions for the latest PR commit is pending.
- Not implemented yet: meshing-job cancellation orchestration, bounded streaming, generators, persisted voxel extension/binary asset adapter, static collision generation, and Editor/Player voxel acceptance scene.

## M7 architecture decisions and next work

- [ADR 0005 — World/Voxel package boundaries](ADR/0005-world-voxel-package-boundaries.md)
- [ADR 0006 — Chunk coordinates and dimensions](ADR/0006-chunk-coordinates.md)
- [ADR 0007 — Dense cell storage and palette](ADR/0007-voxel-cell-storage.md)
- [ADR 0008 — CPU meshing and chunk borders](ADR/0008-voxel-meshing.md)
- [ADR 0009 — Bounded streaming lifecycle](ADR/0009-world-streaming.md)
- [ADR 0010 — Persistence and asset blobs](ADR/0010-voxel-serialization.md)
- [ADR 0011 — Static voxel collision](ADR/0011-voxel-static-collision.md)

Next sequence:

1. Validate decisions against public APIs in geometry, assets, serialization, Editor
   ProjectAssetStore and physics.
2. Implement validated world settings, immutable chunk snapshots, dense Uint16 cell payloads and
   palette references with stable errors.
3. Implement deterministic face-culling CPU meshing against immutable chunk/neighbor snapshots.
4. Add revision invalidation and cancellation before streaming concurrency.
5. Add bounded streaming/generator APIs, persistence adapter and mixed Player/Editor acceptance
   scene.

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
