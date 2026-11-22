# M8 Execution Plan — Animation & Audio

**Status: STARTED — contract baseline and implementation branch created.**  
**Branch:** `feat/m8-animation-audio`  
**Base:** M7 accepted and squash-merged to `main` as `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2` (PR #90).  
**Updated:** 2026-11-22

## Scope

M8 delivers a complete first skeletal-animation path and a browser spatial-audio path, while preserving the engine's package boundaries. Normative API, data, lifecycle, limits, and error contracts live in [Animation & Audio Specification](ANIMATION_AUDIO_SPEC.md). This plan tracks sequencing and evidence; it does not duplicate the normative API.

### Required deliverables

1. `@engine/animation`: immutable skeleton/clip/track contracts, validated deterministic samplers, pose blending, playback controls, cross-fade, and skinning palette calculation.
2. `@engine/gltf-importer`: GLB skin, inverse-bind matrix and animation channel import with strict accessor/joint validation and explicit unsupported-feature diagnostics.
3. `@engine/renderer`: backend-neutral skinned render input and Three.js adapter skinning without leaking Three.js types.
4. `@engine/audio`: backend-neutral source/listener/voice API, bounded resource/voice lifecycle, fake backend contract tests, and explicit browser Web Audio adapter initialization.
5. Player acceptance scene: animated imported character plus positional audio; audio begins only after a user gesture.
6. Specs, ADRs, fixtures, tests, benchmark notes, and handoff updated in each implementation slice.

## Sequencing

| Phase                   | Work                                                                                 | Exit evidence                                                          | Status                                |
| ----------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------- |
| 0. Contracts            | This spec, plan, ADR 0013, package boundaries, error/limit policy                    | Docs reviewed, dependency direction checked, package API tests planned | Complete                              |
| 1. CPU animation        | Track validation/sampling, quaternion interpolation, pose blend, playback/cross-fade | Deterministic unit tests and typed public API                          | Complete                              |
| 2. GLB animation import | Skin joints, inverse bind matrices, animation sampler/channel data                   | Valid/malformed fixtures, accessor bounds and capability diagnostics   | Complete for M8 TRS + 4 influences    |
| 3. Renderer skinning    | Palette calculation integration and backend upload                                   | Matrix fixtures, WebGL2 skinned-character E2E, GPU resource cleanup    | Not started                           |
| 4. Spatial audio        | Audio contracts, Web Audio adapter, decode/voice lifecycle, attenuation              | Fake backend contract tests and browser audio lifecycle E2E            | Contracts complete; Web Audio pending |
| 5. Acceptance/closeout  | Player example, docs, performance/resource evidence, owner review                    | Exact-head CI, Chromium review, explicit owner acceptance              | Not started                           |

## Architecture rules

- `engine-core` stays browser/renderer/audio independent.
- `engine-animation` operates on typed CPU data; no Three.js or DOM types.
- GLB parsing stays in `engine-gltf-importer`; it normalizes data and does not run animation.
- Renderer owns GPU skinning resources; imported CPU data remains authoritative and recoverable.
- `engine-audio` owns backend abstraction and Web Audio adapter; AudioContext is injected/created only through explicit host activation, never at import or startup without gesture.
- Audio is presentation-only; no coupling to fixed-step physics or deterministic simulation.
- Do not persist new scene animation/audio components until their asset-reference schema and migration strategy are reviewed.
- No AI features before M10; no milestone reordering.

## Initial repository findings

- GLB importer currently imports meshes, materials, textures, and node hierarchy/TRS, but its public `GlbAsset` has no skins or animations. The JSON root type likewise omits `skins` and `animations`.
- Renderer currently accepts static `MeshData` render objects and maps them to Three.js `Mesh`; no skinned render contract exists.
- Core has local Transform components, hierarchy propagation and fixed/variable scheduler phases, but no animation-specific runtime integration.
- Asset kinds already include `audio` and `animation`; the asset registry owns metadata and not decoded resources.
- Browser audio policy requires explicit AudioContext resume from a user gesture. No existing audio backend or audio runtime package was found.

## Verification commands

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Record exact branch/head, GitHub Actions run, test totals, Node/pnpm/browser versions, fixture limits, and known limitations. Performance budgets require repeatable browser/device measurements and must not be inferred from Node microbenchmarks.

## Deferred / non-goals

Morph targets, retargeting, animation graph editor, root-motion physics, IK/ragdolls, audio mixer/effects UI, streamed music, deterministic audio/network synchronization, and AI authoring are outside M8. See the normative specification for the full boundary.

## Progress log

### 2026-11-22 — M8 kickoff

- M7 owner acceptance recorded; PR #90 squash-merged to `main` at `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`.
- Created `feat/m8-animation-audio` from the merge commit.
- Read roadmap, subsystem contracts, engine/runtime/renderer/API specifications, project handoff, importer, renderer and core implementation.
- Added the M8 normative contract baseline and execution plan. Implementation and tests are next; M8 is not complete.

### 2026-11-22 — First runtime contract slice

- Added `@engine/animation` with strict track/clip validation, STEP/LINEAR/CUBICSPLINE sampling, quaternion shortest-path slerp/normalization, pose blending, playback controls, looping/seek and cross-fade state.
- Added `@engine/audio` with a backend-neutral audio backend contract, explicit user-gesture activation, clip decode deduplication, source/listener validation, inverse-distance attenuation, configurable 64 MiB encoded / 600-second decoded clip limits, 32-voice default bound and idempotent teardown. No Web Audio adapter or autoplay behavior is implemented yet.
- Added 12 animation and 7 audio contract tests (19 total); the GLB importer suite now contains 37 tests. Full workspace verification passed: format, lint, typecheck, 307/307 Vitest tests and production builds.
- Current limitation at this point in the history: GLB importer, renderer skinning, browser Web Audio backend and Player acceptance scene remained future phases; see the later GLB import progress entry below.

### 2026-11-22 — GLB skin/animation import and CPU palette

- Extended `GlbAsset` with normalized skins, joint node indices, column-major inverse-bind matrices, and animation clips/tracks. Missing inverse-bind accessors produce per-joint identity matrices.
- Added `JOINTS_0` / `WEIGHTS_0` import (four influences), per-vertex weight normalization, skinned node/skin/mesh cross-validation, joint-index bounds, and explicit rejection of `JOINTS_1` / `WEIGHTS_1`.
- Added glTF STEP/LINEAR/CUBICSPLINE channel import for translation, rotation and scale. Morph `weights` targets remain explicitly unsupported. Defaults: 256 joints/skin, 10,000 tracks and 1,000,000 aggregate animation keys; import settings can lower or raise these positive limits.
- Added `computeSkinningPalette` to `@engine/animation` using `inverse(meshWorld) * jointWorld * inverseBindMatrix` in column-major order, with singular/missing matrix validation.
- Added five GLB importer tests and two CPU skinning palette tests. Renderer GPU skinning, actual animated Player rendering and Web Audio remain open.

- Full workspace verification after the importer/palette slice: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (307/307) and `pnpm build` all passed locally. The full Chromium Playwright suite passed: 29/29. The existing directory-project streaming test now has a 60-second test budget (it needs about 18 seconds on this runner when the suite is uncontended).

### 2026-11-22 — Browser regression verification

- Full Chromium Playwright suite passed: 29/29 tests, including GLB import/save/reopen, directory project streaming, renderer resource cleanup, Editor mobile workflows, physics playground and Player shutdown.
- The directory-project streaming test has an explicit 60-second budget to avoid false timeouts on slower WebGL test hosts; the clean full-suite run completed successfully.

### 2026-11-22 — Audio teardown hardening

- `AudioRuntime.dispose()` now waits for pending clip decodes to settle before disposing the backend. Late decoded handles are released and report `DISPOSED`, avoiding a decode-completion-after-backend-disposal leak.
- Added an explicit in-flight decode teardown test. Audio package suite is now 7 tests; workspace total is 307.
