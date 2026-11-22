# ADR 0013: Animation and audio package boundaries

- **Status:** Accepted for M8 implementation baseline
- **Date:** 2026-11-22
- **Decision owners:** Project owner / engine architecture

## Context

M8 adds skeletal animation and spatial audio to a browser-first TypeScript engine. The existing GLB importer owns format parsing, the renderer hides Three.js, core owns transforms and update phases, and assets owns metadata/resource leases. Putting browser APIs or renderer objects into core would make the runtime difficult to test and would violate established dependency direction. Audio additionally has browser autoplay restrictions and is presentation output rather than simulation state.

## Decision

1. Add `@engine/animation` as a CPU-only feature package. It owns validated skeleton/clip/track data, deterministic sampling/blending, playback state and skinning palette math. It does not parse GLB or allocate GPU resources.
2. Extend `@engine/gltf-importer` to normalize glTF skins, inverse-bind matrices and supported TRS animation channels. Unsupported morph/weights channels are diagnosed, never silently discarded.
3. Extend `@engine/renderer` with backend-neutral skinning inputs. Three.js skinning and GPU resource ownership remain inside the renderer adapter.
4. Add `@engine/audio` with backend-neutral clip/source/listener/voice contracts and a Web Audio adapter. AudioContext activation is explicit and must originate from a user gesture; browser node types do not escape the adapter.
5. Keep audio out of deterministic fixed-step state and serialization. Persisted animation/audio components are deferred until scene schema and migration requirements are reviewed.
6. Both feature packages must expose root exports, stable error codes, bounded resource limits, lifecycle semantics and tests. No React dependency is allowed.

## Consequences

- CPU animation can be unit-tested without WebGL or a browser.
- Importer fixtures can validate malformed animation/skin data before renderer work begins.
- Renderer backend can change without changing clip or skeleton assets.
- Audio can be tested against a fake backend, while Chromium E2E validates actual Web Audio behavior where permitted.
- There is an explicit boundary between simulation time and presentation/audio time.

## Alternatives rejected

- **Put animation/audio in `engine-core`:** rejected because it couples foundational ECS to optional features and browser lifecycle.
- **Expose Three.js `SkinnedMesh` or `Audio` objects:** rejected because backend implementation types must not leak into public engine APIs.
- **Use DOM `<audio>` elements as the engine contract:** rejected because it does not provide a consistent spatial source/listener abstraction or explicit resource graph.
- **Auto-resume audio on project load:** rejected due to browser autoplay policy and unwanted playback.
