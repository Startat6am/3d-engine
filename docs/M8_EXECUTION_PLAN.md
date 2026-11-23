# M8 Execution Plan — Animation & Audio

**Status:** M8.0–M8.2 complete; M8.3 renderer and Player integration in progress.
**Baseline:** `main` at M7 merge `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`.
**Branch:** `feat/m8-animation-audio-contracts`.
**Normative contract:** [Animation & Audio Specification](ANIMATION_AUDIO_SPEC.md).
**Architecture decision:** [ADR-0013](ADR/0013-animation-audio-package-boundaries.md).

## 1. Entry gate

M7 World & Voxels was merged and owner-accepted on 2026-11-22. Exact-head workflow run [#45022849198](https://github.com/Startat6am/3d-engine/actions/runs/45022849198) passed for merge commit `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`. This is the M8 implementation baseline.

Audit findings from that baseline:

- ECS `SystemScheduler` supports fixed and variable update phases; `EngineHost` owns ordered service startup/shutdown.
- `@engine/gltf-importer` parses GLB meshes, materials, nodes and embedded image resources; M8.1 extends this baseline with skin and animation data.
- `@engine/renderer` exposes backend-neutral render objects with geometry/material/TRS or world matrix; no skeletal palette is present.
- `@engine/animation` and `@engine/audio` do not exist.
- World v1 persists project data and assets, but no animation/audio built-in components are wired into Editor/Player.

## 2. Ordered implementation slices

Each slice is a separate reviewable PR or a clearly isolated commit series. Do not start a later slice until its predecessor's contracts and tests pass.

### M8.0 — Contract and architecture baseline (this branch)

- Correct stale M7 status in roadmap and handoff.
- Define public subsystem responsibilities, time/coordinate conventions, resource ownership, errors, limits, serialization rules and acceptance.
- Record package-boundary decision and dependency direction.
- Exit: docs are linked from README/roadmap; no runtime capability was implied by the docs-only slice. Contract baseline is now established.

### M8.1 — Animation data model and GLB import

- Add readonly animation/skeleton data structures and validators to `@engine/animation`. (First slice implemented: validated track/clip/skin data and allocation-conscious STEP/LINEAR/CUBICSPLINE sampling.)
- Extend GLB importer with skins, inverse bind matrices, animation samplers/channels, supported interpolation and bounded accessor validation. (Implemented: ordered joint references, default identity inverse-bind matrices, validated JOINTS_0/WEIGHTS_0 vertex influences, translation/rotation/scale channels, STEP/LINEAR/CUBICSPLINE decoding, malformed-reference checks and animation/skin budgets.)
- Preserve node/joint indices and source asset identity; reject unsupported/malformed data with typed errors.
- Tests: synthetic fixtures cover STEP/LINEAR/CUBICSPLINE, translation/rotation/scale, malformed accessors, invalid joint references and limits; the Khronos Fox GLB provides a real-world skinned asset with 24 joints and Survey/Walk/Run clips.
- Sparse accessors are explicitly rejected with `UNSUPPORTED_FEATURE` until bounded sparse decoding is implemented; `JOINTS_1`/`WEIGHTS_1` are likewise unsupported (only the first influence set is imported).
- Exit: deterministic importer output and package API tests; no rendering claim yet.

### M8.2 — Playback and skeletal pose evaluation

- Implement clip player state machine, time advancement, seek, loop/once, speed and two-clip cross-fade.
- Implemented clip playback controls (play/pause/resume/stop/seek, loop/once, positive speed), bounded large-delta time advancement and two-clip cross-fade.
- Implemented local TRS pose evaluation, defensive pose snapshots, hierarchy validation and mesh-local skinning matrices (`inverse(meshWorld) * jointWorld * inverseBindMatrix`).
- Added `AnimationPlayerSystem` in ECS `variable-update`; it does not write physics-owned entity transforms.
- Tests cover state transitions, interpolation, quaternion blending, large deltas, hierarchy cycles, invalid parents, singular mesh transforms and ECS scheduling.
- Khronos Fox end-to-end fixture now drives Survey through two independent players and verifies identical finite 24-joint palettes.
- Benchmark (`pnpm --filter @engine/animation bench:pose`): 10,000 evaluations, 24 joints / 48 channels, five rounds; exact-head CI on Node v22.23.5 recorded median 768.16 ms (13,018 evaluations/s). This is an informational runner-specific baseline, not a CI threshold or a hardware performance guarantee.
- Allocation review: internal playback reuses pose buffers; the benchmark intentionally includes defensive public pose snapshots and skinning palette evaluation. Snapshot copies remain deliberate API isolation, not a hidden mutable view.
- Exit: exact-head GitHub Actions run [#45208613537](https://github.com/Startat6am/3d-engine/actions/runs/45208613537) passed format, lint, typecheck, tests, build, Node 22 pose benchmark, GLB/voxel stress checks and Chromium Playwright E2E.

### M8.3 — Renderer skinning path

- Implemented: `RenderSkinning` carries four palette-local influences per vertex and column-major mesh-local joint matrices, bounded to 256 joints.
- Implemented: Three.js adapter creates isolated skinned geometry, uses detached bind matrices and a bone texture, applies engine palettes before draws, handles skinning changes and disposes skeleton/geometry resources. Skinned meshes disable frustum culling until animated bounds are maintained.
- Implemented: Player reconstructs the imported GLB bind pose and node-parent graph, starts the first clip and updates all mesh-local palettes before rendering. Player declares the direct animation workspace dependency.
- Unit tests cover geometry isolation, palette mapping/update, joint-count validation and weighted vertex deformation.
- Implemented: a `?fixture=fox` Player acceptance route loads the attributed Khronos Fox asset. Chromium verifies actual WebGL draw calls, visible pixels and Survey-to-Walk cross-fade via the `]` shortcut. The first fixture E2E run passed.
- Pending: skinned-resource teardown E2E on the Fox fixture and a new exact-head CI run after that test.
- Exit: exact-head Chromium acceptance verifies visible deformation, cross-fade and skeleton/bone-texture/geometry teardown without Editor imports; all workspace quality gates pass. Do not mark M8.3 complete before this gate.

### M8.4 — Audio contracts and Web Audio adapter

- Add `@engine/audio` core contracts, clip registry/leases, source/listener state, attenuation and lifecycle.
- Implement Web Audio adapter with explicit gesture-gated resume, mono spatial and stereo non-spatial playback.
- Add graceful unsupported/autoplay-denied fallback and bounded async decode.
- Tests: fake backend lifecycle, attenuation, leases, cancellation, permission and disposal; Chromium browser acceptance.
- Exit: source/listener movement affects spatial playback and resources release on removal/stop.

### M8.5 — Player integration and project persistence

- Complete Player animation/audio service composition; synchronize after transforms and before rendering/audio submission.
- Add stable, versioned component records only where needed; preserve world v1 compatibility or provide explicit migration fixtures.
- Verify load/save/reopen of animated/audio-enabled scenes without serializing runtime handles.
- Exit: Player loads an authored fixture project and tears down cleanly.

### M8.6 — Examples, benchmarks and owner acceptance

- Add minimal animated-character and spatial-audio acceptance scenes with setup instructions.
- Measure import cost, pose evaluation at representative joint counts, audio decode/voice lifecycle and memory/resource release.
- Run full workspace gates and Chromium E2E; document unsupported browser/device cases.
- Exit: exact-head CI green, examples pass, benchmark metadata recorded, known limitations listed, owner accepts M8.

## 3. Dependency rules

- `@engine/animation` -> `@engine/core`; importer may depend on animation data contracts. Animation must not depend on renderer/Three.js.
- `@engine/audio` -> `@engine/core`; browser Web Audio adapter is isolated from core and may be lazy-created.
- Renderer consumes pose snapshots; it does not own animation clocks or canonical skeleton state.
- Player composes the systems; Editor UI work belongs to M9.
- No new provider, network, AI, React or editor dependency in core/player runtime.
- Do not add morph targets, animation graphs, IK, root motion, audio effects racks, microphone input or workers without measured need and a new decision.

## 4. Quality gates

Requirements remain Node.js 22.12+ and pnpm 12.18.0. Run:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Every implementation slice updates this plan, [ANIMATION_AUDIO_SPEC.md](ANIMATION_AUDIO_SPEC.md), package tests/examples and [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md). Record exact branch/head, CI run, test totals, browser/runtime and fixture sizes. Never infer success from a local build or an unrelated commit's CI.

## 5. Current next action

M8.1 importer coverage includes rotation/scale channels, an attributed Khronos Fox GLB fixture, explicit sparse-accessor rejection and vertex joint/weight attributes. Sparse decoding and additional influence sets remain explicitly unsupported. M8.2 is complete: headless player, cross-fade, local-pose evaluation, hierarchy-aware skinning matrices and ECS variable-update integration passed the exact-head Node 22 and Chromium CI gate. M8.3 is active. The backend-neutral palette contract, Three.js `SkinnedMesh` bridge and Player GLB animation/palette path are implemented. Next: add a browser-rendered Khronos Fox fixture and Chromium assertions for visible deformation, clip switching/cross-fade and teardown. Keep renderer implementation isolated from animation clocks and canonical pose ownership.
