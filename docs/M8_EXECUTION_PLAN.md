# M8 Execution Plan — Animation & Audio

**Status:** planning/contract baseline in progress; no runtime implementation claimed.
**Baseline:** `main` at M7 merge `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`.
**Branch:** `feat/m8-animation-audio-contracts`.
**Normative contract:** [Animation & Audio Specification](ANIMATION_AUDIO_SPEC.md).
**Architecture decision:** [ADR-0013](ADR/0013-animation-audio-package-boundaries.md).

## 1. Entry gate

M7 World & Voxels was merged and owner-accepted on 2026-11-22. Exact-head workflow run [#45022849198](https://github.com/Startat6am/3d-engine/actions/runs/45022849198) passed for merge commit `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`. This is the M8 implementation baseline.

Audit findings from that baseline:
- ECS `SystemScheduler` supports fixed and variable update phases; `EngineHost` owns ordered service startup/shutdown.
- `@engine/gltf-importer` parses GLB meshes, materials, nodes and embedded image resources, but its `GlbAsset` has no skins or animation channels.
- `@engine/renderer` exposes backend-neutral render objects with geometry/material/TRS or world matrix; no skeletal palette is present.
- `@engine/animation` and `@engine/audio` do not exist.
- World v1 persists project data and assets, but no animation/audio built-in components are wired into Editor/Player.

## 2. Ordered implementation slices

Each slice is a separate reviewable PR or a clearly isolated commit series. Do not start a later slice until its predecessor's contracts and tests pass.

### M8.0 — Contract and architecture baseline (this branch)
- Correct stale M7 status in roadmap and handoff.
- Define public subsystem responsibilities, time/coordinate conventions, resource ownership, errors, limits, serialization rules and acceptance.
- Record package-boundary decision and dependency direction.
- Exit: docs are linked from README/roadmap; no implementation is implied.

### M8.1 — Animation data model and GLB import
- Add readonly animation/skeleton data structures and validators to `@engine/animation`.
- Extend GLB importer with skins, inverse bind matrices, animation samplers/channels, supported interpolation and bounded accessor validation.
- Preserve node/joint indices and source asset identity; reject unsupported/malformed data with typed errors.
- Tests: GLB fixtures for STEP/LINEAR/CUBICSPLINE, translation/rotation/scale, malformed accessors, invalid joint references and limits.
- Exit: deterministic importer output and package API tests; no rendering claim yet.

### M8.2 — Playback and skeletal pose evaluation
- Implement clip player state machine, time advancement, seek, loop/once, speed and two-clip cross-fade.
- Evaluate local joint transforms and skinning matrices from skeleton hierarchy and inverse bind matrices.
- Integrate with ECS variable-update phase and expose immutable pose snapshots.
- Tests: sampling math, quaternion handling, hierarchy, state transitions, large deltas, repeatability and disposal.
- Exit: headless pose fixtures pass; animation cannot mutate physics-owned entity transforms.

### M8.3 — Renderer skinning path
- Add explicit backend-neutral skinning palette/vertex influence contract and bounded joint palette support.
- Adapt Three.js renderer to render skinned GLB fixtures; keep backend objects private.
- Tests: CPU contract/validation and Chromium render acceptance for at least one animated character.
- Exit: Player visually renders two clips and cross-fade without editor imports.

### M8.4 — Audio contracts and Web Audio adapter
- Add `@engine/audio` core contracts, clip registry/leases, source/listener state, attenuation and lifecycle.
- Implement Web Audio adapter with explicit gesture-gated resume, mono spatial and stereo non-spatial playback.
- Add graceful unsupported/autoplay-denied fallback and bounded async decode.
- Tests: fake backend lifecycle, attenuation, leases, cancellation, permission and disposal; Chromium browser acceptance.
- Exit: source/listener movement affects spatial playback and resources release on removal/stop.

### M8.5 — Player integration and project persistence
- Compose animation/audio services in Player; synchronize after transforms and before rendering/audio submission.
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

M8.0 documentation baseline is being established on `feat/m8-animation-audio-contracts`. After review, begin M8.1 with the animation data model and GLB importer extension. Do not create placeholder package APIs before the contracts and importer fixtures are agreed.
