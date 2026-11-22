# ADR-0013: Animation and audio package boundaries

- **Status:** Proposed for M8 implementation
- **Date:** 2026-11-22
- **Decision owners:** Project owner
- **Related:** [Architecture](../ARCHITECTURE.md), [Subsystem Contracts](../SUBSYSTEM_CONTRACTS.md), [Animation & Audio Specification](../ANIMATION_AUDIO_SPEC.md)

## Context

M8 introduces skeletal animation and spatial audio into a browser-first engine. Existing architecture requires feature packages to depend on core contracts, renderer backends to remain replaceable, Editor and Player to share engine packages, and runtime resources to have explicit ownership/disposal.

The current GLB importer returns mesh/material/node data but not glTF skins or animation channels. The ECS scheduler already exposes a variable-update phase and EngineHost provides ordered service lifecycle. No animation/audio packages currently exist.

Putting animation clocks, skeleton state or audio backend objects in engine-core would couple the core to rendering/browser capabilities. Putting them in the renderer would make animation backend-specific and audio impossible to reuse independently. A single combined package would also create unnecessary coupling between animation and audio.

## Decision

1. Create separate `@engine/animation` and `@engine/audio` packages, each depending on `@engine/core` only for engine/ECS contracts.
2. Keep GLB parsing in `@engine/gltf-importer`; its normalized animation/skeleton data uses public animation types and preserves glTF node/joint ordering.
3. Keep playback clocks and canonical evaluated pose in `@engine/animation`. Renderer receives immutable pose/palette snapshots through a backend-neutral contract; renderer does not own clip timing.
4. Keep audio source/listener contracts and lifecycle in `@engine/audio`. Browser Web Audio is an adapter created lazily after explicit host/user activation; importing the package must not access browser globals.
5. Player composes services and synchronizes them with ECS/transform lifecycle. Editor-specific animation/audio authoring remains M9.
6. Persist only stable component settings and asset references. Never serialize AudioNodes, decoded buffers, runtime clocks, callbacks or GPU handles.

## Scheduling

- Animation advances once in ECS `variable-update`, after fixed simulation updates and before render extraction.
- Animation does not write physics-owned entity transforms. M8 skeletal animation is joint-pose evaluation only; root motion is deferred.
- Audio source/listener transforms synchronize after transform propagation and before backend submission. Audio time remains backend-owned.

## Consequences

Positive:
- Headless tests can validate animation and audio contracts without a browser or renderer.
- Renderer and audio backends remain replaceable.
- Resource ownership and lifecycle are independently testable.
- Player can use the same runtime packages without importing Editor.

Trade-offs:
- A small shared data contract is needed between importer, animation and renderer.
- Player must coordinate update order and shutdown explicitly.
- Skeletal rendering requires a separate renderer integration slice after animation math is stable.

## Rejected alternatives

- **Put all features in engine-core:** rejected because core must remain browser/renderer-independent.
- **Put animation in renderer:** rejected because animation state and sampling must be testable without a GPU and portable across renderers.
- **Put audio in renderer:** rejected because audio has a separate clock, permission model and device lifecycle.
- **One combined animation-audio package:** rejected because the domains have independent dependencies, runtime states and testing needs.
