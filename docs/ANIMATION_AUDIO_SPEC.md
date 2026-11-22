# Animation & Audio Specification

**Status:** M8 contract baseline (implementation in progress)  
**Contract version:** 0.1.0-draft  
**Milestone:** M8; M9 Editor MVP and M10 AI Authoring remain in their existing order.

## 1. Purpose and package boundaries

M8 adds two runtime subsystems without making `engine-core` or the renderer depend on browser APIs:

- `@engine/animation` owns skeletal data contracts, deterministic clip sampling, pose blending, playback state, and skinning palette calculation. It consumes normalized imported animation data and produces pose data; it does not parse GLB, create GPU objects, or own ECS entities.
- `@engine/audio` owns audio clip/source/listener contracts, source playback state, spatial attenuation/panning policy, and a backend interface. Its browser adapter owns Web Audio nodes and decoded buffers; gameplay-facing code does not receive `AudioContext` or node instances.
- `@engine-gltf-importer` remains responsible for GLB parsing and normalizes glTF skins, inverse-bind matrices, animation samplers/channels, and joint/target references into importer-owned data structures.
- `@engine-renderer` consumes backend-neutral skinning palettes and owns GPU upload/skinning implementation. Three.js types must not escape the adapter.
- `@engine-core` remains renderer- and browser-independent. Runtime integration is explicit and phase-ordered; audio output is not part of deterministic simulation state.

No React/editor dependency may enter animation, audio, importer, core, or Player runtime packages.

## 2. Coordinate, time, and numeric conventions

- World coordinates are right-handed, +Y up, metres for world distance, and seconds for time.
- glTF node/joint indices are stable within one imported asset and are not ECS entity IDs.
- Matrices are 4×4 column-major. Quaternions are `[x, y, z, w]` and normalized at public input boundaries.
- Animation clip time is seconds. Sampling clamps to the clip interval by default; explicit looping wraps time into `[0, duration)`.
- Animation evaluation is deterministic for identical clip data, time, and blend inputs. Audio rendering is real-time and not deterministic/replay-authoritative.
- Translation/scale use linear interpolation; rotation uses shortest-path quaternion slerp for LINEAR tracks; STEP holds the previous key; CUBICSPLINE uses glTF Hermite tangents and normalizes quaternion results.

## 3. Skeletal animation data contract

An imported skin contains an ordered joint-node index list and one inverse-bind matrix per joint. If inverse-bind matrices are absent, identity matrices are used per glTF. The GLB importer currently caps a skin at 256 joints by default (`maxJoints` import setting). Joint indices must reference existing nodes, skin joint lists must not contain duplicates, and a skinned mesh node must reference an existing skin. The first importer slice supports four influences (`JOINTS_0` / `WEIGHTS_0`) and normalizes each vertex weight tuple; `JOINTS_1` / `WEIGHTS_1` are explicitly unsupported.

An animation clip contains a stable name, duration, and tracks. Each track targets one node and one path (`translation`, `rotation`, or `scale`), has strictly increasing finite key times, an interpolation mode (`STEP`, `LINEAR`, `CUBICSPLINE`), and typed values. The current GLB importer defaults to at most 10,000 tracks and 1,000,000 aggregate keyframes per asset (`maxAnimationTracks` / `maxAnimationKeys` import settings). CUBICSPLINE stores in-tangent, value, out-tangent triplets per key as required by glTF. Unsupported weights/morph-target animation is reported as a capability diagnostic until a later extension; it must not be silently treated as skeletal TRS animation.

The runtime pose is a set of local TRS transforms keyed by imported node index. Clip blending uses normalized non-negative weights. A single base pose can be layered with weighted overrides; additive animation is explicitly out of the first M8 contract. Missing tracks preserve the bind/default local transform. Cross-fades advance both source and target clocks and interpolate their sampled poses over a caller-supplied duration.

The skinning palette for a mesh node is computed as `inverse(meshWorld) * jointWorld * inverseBindMatrix` for each joint, using column-major matrices. `@engine/animation` now exposes `computeSkinningPalette` with singular-matrix, missing-joint and matrix-count validation. The CPU matrix order is fixture-tested. The Three.js adapter uploads `skinIndex` / normalized `skinWeight`, creates renderer-owned `SkinnedMesh` / `Skeleton` resources, applies the mesh-relative palette each frame, and releases skeleton/bone resources with the render object. The Player currently advances the first imported clip in a loop; clip-selection UI and animation graphs are outside this slice.

## 4. Animation runtime lifecycle

- A player references immutable clip data and owns playback time, speed, loop mode, playing/paused state, and optional cross-fade state.
- `play`, `pause`, `stop`, `seek`, and `crossFadeTo` are explicit operations.
- `update(deltaSeconds)` rejects negative/non-finite deltas and does not mutate imported clip data.
- Stop resets playback time to zero; pause preserves it; seek clamps to duration; looping wraps only when enabled.
- Disposal is idempotent and subsequent mutation throws a stable `DISPOSED` error.
- Animation evaluation runs in the variable/update path for render interpolation; applications may opt into fixed-step evaluation when animation must be simulation-authoritative. The default Player character presentation is variable-time, not a claim of deterministic network replay.

## 5. Spatial audio contract

A listener has a world position and orientation. A source has a clip reference, world position/orientation, gain, pitch, looping flag, reference distance, maximum distance, rolloff model, and spatial blend (2D to 3D). Distances are metres; gain is linear amplitude; pitch is a positive playback-rate multiplier.

The engine-facing `AudioBackend` exposes capability discovery and opaque handles for decoded clips, listeners, and source voices. The Web Audio adapter maps sources to buffer-source/gain/panner nodes and owns all node connections. `AudioRuntime` bounds decode concurrency (2 active / 8 queued by default), deduplicates in-flight loads, and enforces clip/voice limits. No `AudioContext` is created implicitly by module import or page load. The host explicitly initializes/resumes audio in response to a user gesture to comply with browser autoplay policy.

M8 spatial attenuation contract is inverse-distance clamped: gain multiplier is `referenceDistance / (referenceDistance + rolloff * (distance - referenceDistance))` for distances beyond reference distance, clamped at zero beyond max distance. The backend may additionally apply HRTF/panning when supported; it must report the selected mode. A non-spatial 2D source bypasses positional attenuation.

Audio is presentation output: it does not advance the fixed simulation clock, affect physics, or promise sample-accurate deterministic replay. Muting, pausing, stopping, source stealing/voice limits, decode failure, context suspension, and disposal have explicit observable states/errors.

## 6. Resource ownership and security

- Imported clip data is immutable CPU data. Decoded audio buffers and GPU skinning resources are backend-owned and reference-counted where shared.
- Every voice, decoded clip lease, listener binding, and backend is released on owner disposal. Runtime disposal waits for pending decode promises to settle, releases any late decoded handle, then disposes the backend. Repeated dispose/release is safe.
- Audio decode is asynchronous and cancellable where the platform allows; no file/network I/O occurs in frame callbacks.
- Enforce configurable limits for encoded bytes, decoded duration, active voices, joint count, key count, and simultaneous decode jobs. The initial audio runtime defaults are 64 MiB per encoded clip, 600 seconds per decoded clip, and 32 active voices. The runtime bounds concurrent decodes (2 active and 8 queued by default). Decoded channel-count/sample-rate ceilings and production device profiling remain open. Importer phase must publish joint/key ceilings before accepting untrusted animated assets.
- Treat GLB accessors and audio files as untrusted. Validate ranges, finite values, counts, MIME/type and decoded sizes before allocation or backend submission.
- Do not auto-play newly loaded assets. Playback requires an explicit caller action.

## 7. Errors

Stable error families:

- `AnimationError`: `INVALID_CLIP`, `INVALID_TRACK`, `INVALID_TIME`, `INVALID_WEIGHT`, `INVALID_SKIN`, `UNSUPPORTED_FEATURE`, `DISPOSED`.
- `AudioError`: `INVALID_SOURCE`, `INVALID_LISTENER`, `DECODE_FAILED`, `UNSUPPORTED_FORMAT`, `VOICE_LIMIT`, `RESOURCE_LIMIT`, `CONTEXT_NOT_READY`, `DISPOSED`.
- `GlbImportError`: retain existing codes and use `UNSUPPORTED_FEATURE` for unsupported animation extensions/targets; malformed accessors use `INVALID_ACCESSOR`.

Messages may evolve; callers branch on codes. Errors should include asset/clip/source identity when available, without logging user audio content.

## 8. Compatibility and persistence

M8 first supports imported GLB animation/skin data in memory. Persisted editor animation/audio authoring formats are not introduced until the asset reference and scene component schema is reviewed. Existing project manifests remain readable without migration. If scene-level animation/audio components are persisted later, they require a versioned schema, fixtures, and explicit migration tests. Raw decoded buffers, GPU handles, AudioContext nodes, and playback clocks are never serialized.

## 9. M8 implementation phases

1. Contract + deterministic CPU animation primitives: validate tracks, sample STEP/LINEAR/CUBICSPLINE, blend poses, test cross-fade clock semantics.
2. GLB import: skins, inverse-bind matrices, animation samplers/channels, joint validation, capability diagnostics and fixtures.
3. Renderer skinning: palette convention tests, bounded GPU upload, skinned character visible in Player. **Implemented and covered by Chromium deformation/animation/resource-teardown tests.**
4. Audio core/backend: fake backend contract, explicit Web Audio initialization, decode/play/stop/dispose, spatial listener/source updates and voice bounds. **Implemented; Chromium verifies user-gesture activation and a spatial voice.**
5. Player acceptance harness: animated GLB playback and a separate user-triggered spatial-audio smoke control. **Implemented; full listener/camera synchronization and a scene-authored sound source remain open.**

## 10. Acceptance gates

- Valid GLB fixtures import skin and supported animation channels; malformed joint/accessor/channel data fails with stable errors.
- CPU sampling tests cover key boundaries, STEP/LINEAR/slerp/CUBICSPLINE, looping, seek, negative/invalid time, and cross-fade blending.
- Renderer conformance verifies skinning palette matrix order and resource cleanup; a real skinned GLB visibly deforms and animates in Chromium Player (passed).
- Audio backend tests cover user-gesture initialization boundary, decode failure, 2D/3D source configuration, attenuation, voice limits, stop/pause, and disposal.
- Player Chromium smoke coverage verifies explicit user-triggered audio activation, a running spatial voice, and renderer/audio teardown. Listener movement response and full scene-authored audio integration remain acceptance gaps.
- Format, lint, typecheck, full unit/contract suite, production build, Chromium E2E and benchmark outputs pass on exact PR head.
- Browser/device claims are limited to actually tested environments; no unmeasured FPS, latency, VRAM, or audio-latency budgets are implied.

## 11. Explicit non-goals

No facial/morph-target animation, retargeting, animation graph visual editor, root-motion physics integration, ragdoll, procedural IK, audio mixer UI, effects graph, streaming music system, multiplayer synchronization, deterministic audio, or AI authoring in M8. Revisit only with measured need and a separate decision.
