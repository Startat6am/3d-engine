# Animation & Audio Specification

**Status:** M8.1–M8.2 implemented; M8.3 renderer and Player integration in progress; Fox visual/cross-fade acceptance passes, skinned-resource teardown coverage pending.
**Version:** 0.1.0-draft
**Milestone:** M8 (after M7 World & Voxels, before M9 Editor MVP)

## 1. Goals and boundaries

M8 adds reusable, renderer-independent animation and audio capabilities to Choreon. It must let the Player run an animated GLB character and spatial sound sources, with deterministic lifecycle behavior and no editor dependency.

Planned packages:

- `@engine/animation`: validated animation data, playback state, sampling, blending, skeletal pose evaluation and ECS-facing systems. It depends on `@engine/core`; it must not depend on Three.js, React, DOM or a particular renderer.
- `@engine/audio`: audio source/listener contracts, playback state, spatial parameters and service lifecycle. It depends on `@engine/core`; browser Web Audio is an adapter, not the public contract.
- `@engine/gltf-importer`: extends the existing GLB import result with validated skin, inverse-bind and animation channel data.
- `@engine/renderer`: consumes evaluated skeletal pose through an explicit backend-neutral render contract; Three.js remains an adapter detail.
- Player composes the services and binds audio listener/source transforms to world transforms. Editor UI authoring is M9 unless a narrow acceptance fixture requires otherwise.

These packages do not own entity identity, canonical transforms, asset identity, project storage or editor commands.

## 2. M8 scope

### Animation

- Import core glTF 2.0 animation data from GLB: skins/joints, inverse bind matrices, animation samplers and channels targeting translation, rotation and scale.
- Validate accessor component/type/count relationships, finite values, strictly increasing key times, node and joint references, sampler interpolation and resource budgets before allocating expanded runtime structures.
- Support STEP, LINEAR and CUBICSPLINE interpolation as defined by glTF. Quaternion LINEAR interpolation uses shortest-path normalized slerp; CUBICSPLINE uses glTF Hermite semantics and normalizes sampled rotations.
- Support clip duration, play/pause/stop, seek, speed, loop and once modes, deterministic time advancement, cross-fade between two clips, and multiple independent animation players.
- Evaluate local joint pose and skinning palette from a stable skeleton definition. Parent hierarchy and inverse-bind matrices are explicit; joint order is preserved exactly as authored.
- Expose evaluated pose to renderer without making renderer state canonical. No animation writes to ECS Transform by default; root motion is deferred until separately specified.

### Audio

- Define audio clip identity/data ownership, listener, source, bus/category, gain, pitch, loop, playback state and spatial attenuation parameters.
- Provide a backend-neutral AudioDevice/AudioBackend contract and a browser Web Audio adapter.
- Support one active listener, mono positional sources, non-spatial stereo sources, play/pause/stop, seek where backend supports it, gain, pitch, looping, distance attenuation, panning and source/listener transform updates.
- AudioContext creation/resume is initiated by an explicit user gesture through the host. Engine startup must not assume autoplay permission.
- Decode and playback are asynchronous, cancellable, bounded and dispose-safe. Shared decoded buffers use explicit leases; entity/source removal releases its lease without cancelling other consumers.
- Muted/suspended/unsupported environments degrade gracefully and report typed capability/state diagnostics.

## 3. Explicit non-goals

- Animation graph/state-machine editor, retargeting, IK, ragdolls, facial animation, morph-target animation, animation compression, GPU compute skinning, root motion, network synchronization and deterministic lockstep.
- Audio authoring/mixing UI, effects rack, streaming music pipeline, recording, microphone capture, voice chat, arbitrary script callbacks, MIDI and spatial room acoustics.
- Non-GLB animation interchange, Blender-native parsing, editor timeline UX, packaging installers and AI authoring.
- Promise of bit-identical floating-point results across browsers/devices.

## 4. Coordinate, time and data conventions

- Engine units remain meters, seconds and radians; world up is +Y; quaternion order is XYZW.
- Animation key times and clip duration are seconds. Runtime time is finite and non-negative; playback speed is finite. Negative playback speed is not part of M8.
- Sampling at an exact key time returns that key. Before the first key, use the first value; after the last key, use the last value.
- Clip-local time is wrapped for loop mode and clamped for once mode. Large deltas must not cause unbounded iteration.
- Audio distance is meters. Gain is linear amplitude in [0, 1] at the engine boundary; adapters may convert to backend-specific units. Pitch is a positive playback-rate multiplier.
- Imported source asset bytes remain immutable. Decoded/derived data is runtime cache state and is never serialized as live handles.

## 5. Proposed public contracts

The exact TypeScript surface is finalized in implementation PRs, but the semantic contract is:

```ts
type AnimationPath = 'translation' | 'rotation' | 'scale';
type AnimationInterpolation = 'STEP' | 'LINEAR' | 'CUBICSPLINE';

interface AnimationClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly channels: readonly AnimationChannel[];
}

interface AnimationPlayer {
  play(clipId: string, options?: { loop?: boolean; restart?: boolean }): void;
  crossFade(clipId: string, duration: number, options?: { loop?: boolean }): void;
  pause(): void;
  resume(): void;
  stop(): void;
  seek(seconds: number): void;
  setSpeed(speed: number): void;
  update(deltaSeconds: number): void;
}

interface AudioSourceOptions {
  readonly clipId: string;
  readonly spatial: boolean;
  readonly gain?: number;
  readonly pitch?: number;
  readonly loop?: boolean;
  readonly referenceDistance?: number;
  readonly maxDistance?: number;
  readonly rolloff?: number;
}
```

These examples communicate intent, not an approved ABI. Implementations must export concrete readonly data types, validate public inputs, and document all defaults.

## 6. Runtime ownership and scheduling

- Animation time advances in the ECS `variable-update` phase using the frame delta; it does not advance once per fixed physics substep. Pose evaluation completes before render extraction.
- Physics remains authoritative for physics-driven transforms. Animation must not overwrite a transform owned by a dynamic rigid body. M8 supports skeletal pose animation only; transform/root-motion ownership arbitration is deferred.
- Audio source/listener spatial state is synchronized after transform propagation and before audio backend submission. Audio playback time is backend-owned; it is not tied to fixed physics ticks.
- Services are registered with `EngineHost` and follow existing start/stop/dispose order. Stop is restartable where the underlying backend permits it; dispose is terminal and idempotent.
- Async completion after cancellation, source replacement or disposal must release any produced resources and must not mutate current world state.
- No browser globals are read at module import time. Web Audio capability is detected when the adapter is created.

## 7. Serialization

- Project documents store stable component data only: animation asset/clip references, initial playback settings when explicitly authored, audio clip references and source/listener parameters.
- Never serialize current playback clocks, decoded buffers, AudioNodes, renderer objects, GPU palettes, callbacks or device handles.
- Existing world schema v1 extension/component preservation rules apply. Any new built-in component record must have a stable type ID and explicit schema version.
- M8 does not silently bump world schema version. If a migration is required, add a versioned migration and fixtures before enabling writes.

## 8. Errors and limits

Expected failures are typed and actionable:

- `ANIMATION_INVALID_DATA`, `ANIMATION_UNSUPPORTED_FEATURE`, `ANIMATION_RESOURCE_LIMIT`, `ANIMATION_DISPOSED`, `ANIMATION_UNKNOWN_CLIP`.
- `AUDIO_UNAVAILABLE`, `AUDIO_PERMISSION_REQUIRED`, `AUDIO_DECODE_FAILED`, `AUDIO_RESOURCE_LIMIT`, `AUDIO_DISPOSED`, `AUDIO_UNKNOWN_CLIP`.

Limits must cover source bytes, decoded audio bytes/duration, clip/channel/key counts, joints per skin, animation duration and concurrent voices. Initial numeric defaults are to be selected from representative fixtures and recorded in code/spec; do not invent performance guarantees before benchmarks.

## 9. Verification and acceptance

Unit/contract tests:

- interpolation boundaries, duplicate/descending/non-finite key times, quaternion normalization and CUBICSPLINE sampling;
- hierarchy ordering, skin/joint index validation, inverse-bind count and deterministic pose evaluation;
- playback state transitions, seek, loop wrapping, once clamping, large deltas and cross-fade endpoints;
- malformed GLB animation accessors/channels/skins and resource-budget rejection before large allocations;
- audio option validation, attenuation math, listener selection, async decode cancellation, shared-buffer leases, autoplay permission, and stop/dispose races.

Integration/acceptance:

- Player loads a fixture GLB with a skinned character, plays at least two clips, cross-fades them and renders the resulting pose.
- Player plays one positional mono sound and one non-spatial sound; moving the listener/source changes spatial output in a browser that supports Web Audio.
- Removing entities, replacing assets, stopping Player and disposing EngineHost release animation/audio resources; repeated start/stop does not leak or duplicate backend nodes.
- CI runs headless deterministic unit tests and Chromium browser acceptance. Unsupported audio environments must pass graceful-fallback assertions.
- Record exact commit, CI run, browser/runtime versions, fixture sizes, joint/key/voice counts and measured results. Do not claim hardware or cross-browser acceptance from Chromium-only CI.

## 10. Known baseline gaps

At the M8 implementation checkpoint:

- `@engine/animation` exports validated track/clip/skin data, STEP/LINEAR/CUBICSPLINE sampling, play/pause/stop/seek/loop/once/positive-speed controls, two-clip cross-fade, local TRS pose evaluation, defensive pose snapshots, hierarchy-aware mesh-local skinning matrices and an ECS variable-update system. The Khronos Fox fixture verifies deterministic 24-joint palette output. Exact-head CI #45208613537 passes on Node 22.23.5 and Chromium; the 24-joint / 48-channel benchmark recorded 13,018 evaluations/s (runner-specific, informational). Three.js renderer and Player palette integration are implemented; Chromium Fox visual and Survey-to-Walk cross-fade acceptance passes, while skinned-resource teardown coverage remains. `@engine/audio` does not exist.
- `GlbAsset` exposes validated skins, ordered joints, inverse-bind matrices, per-vertex JOINTS_0/WEIGHTS_0 influences and translation/rotation/scale animation channels with bounded accessor decoding. Player now creates a bind pose and hierarchy from imported nodes, starts the first clip and updates mesh-local palettes each frame. Only the first JOINTS_0/WEIGHTS_0 influence set is supported.
- Sparse accessors and `JOINTS_1`/`WEIGHTS_1` are rejected as unsupported rather than partially decoded. The importer regression suite includes the attributed Khronos Fox sample (162,852 bytes; 24 joints; Survey/Walk/Run clips); see [fixture attribution](../packages/engine-gltf-importer/src/fixtures/README.md).
- `AnimationPlayerSystem` advances animation components in ECS `variable-update`; it publishes pose snapshots and does not mutate physics-owned entity transforms. Audio remains unintegrated.
- `RenderObject` now optionally carries `RenderSkinning`. The Three.js adapter creates isolated skinned geometry, maps the engine-owned mesh-local palette through `SkinnedMesh`/`Skeleton`, uses a bone texture for the 256-joint limit, updates palettes before draws and disposes per-object skinning resources. Frustum culling is disabled for skinned meshes until animated bounds are computed.
- Player project loading now plays imported GLB clips and renders their skinning palettes. The built-in `?fixture=fox` acceptance route auto-plays the first clip; `[` and `]` cross-fade between imported clips over 350 ms. Chromium verifies visible Fox rendering and Survey-to-Walk cross-fade. Editor-authored animation components, serialized playback state and audio persistence remain unimplemented; Fox-specific GPU teardown coverage is pending.

Do not mark any capability implemented until code, tests, examples and the relevant acceptance gate agree.
