# ADR 0014: Versioned persisted audio-source component

- **Status:** Proposed for implementation; persistence is not enabled by this ADR alone
- **Date:** 2026-11-22
- **Decision owners:** Project owner / engine architecture

## Context

M8 has a backend-neutral `AudioSource` runtime contract and a working Web Audio adapter, but the Player currently exposes only a user-gesture smoke control. A scene-authored source needs a stable asset reference, portable settings, predictable activation semantics, and validation shared by Editor, Player, and project storage.

The current world envelope is `1.0.0`. Entity component objects are intentionally open-ended JSON, but `engine-serialization` performs explicit cross-document validation only for `MeshRenderer` asset references. `WorldMigrationRegistry` supports ordered migrations, but `parseWorld` defaults to an empty registry. Editor serialization currently writes `1.0.0` directly, its scene model only represents renderable entities, and Player's entity loader currently requires both `Transform` and `MeshRenderer`. Therefore adding an `AudioSource` property alone would create a component that can be saved without reliable validation or loaded consistently by all hosts.

## Decision

Do not persist `AudioSource` in world `1.0.0` documents or ship a one-off editor-only representation. Implement the following as one coherent schema slice before exposing authoring UI:

1. Advance the world schema to `1.1.0` and retain an explicit `1.0.0 -> 1.1.0` migration. The migration must preserve all existing entities, components, assets, payloads, and extensions byte-semantically; it must not synthesize audio components.
2. Register the migration in the default `parseWorld` path so Editor, Player, and project storage do not need to remember to pass a private migration registry. Custom migration registries remain supported for application-specific legacy chains.
3. Define `components.AudioSource` as portable JSON only: `assetId` (required, resolves to an asset with `kind: "audio"`), `spatial` (boolean), `loop` (boolean), `gain` (finite, bounded non-negative value), `referenceDistance` (finite positive value), `maxDistance` (finite and not less than reference distance), and `playOnEnable` (boolean). Defaults are applied by the runtime/authoring layer, not silently inserted into imported documents.
4. Treat `playOnEnable` as “start after the user explicitly enables audio in this Player session,” never as permission to autoplay during load. Runtime handles, decoded buffers, AudioContext nodes, voice IDs, and playback clocks remain transient and are never serialized.
5. Permit an audio source on an entity that has a Transform but no MeshRenderer. Its world transform is the source transform. Entity loading must no longer discard valid audio-only entities as unsupported geometry.
6. Editor authoring must select an existing audio asset from the project registry; it must not persist filesystem paths or embed decoded audio state. Asset removal must continue to reject referenced assets.
7. Add schema fixtures and migration tests for old worlds, valid audio sources, missing references, wrong asset kinds, invalid spatial values, audio-only entities, and round-trip persistence before adding the UI/runtime playback path.

## Consequences

- Existing `1.0.0` worlds remain readable through a deterministic built-in migration.
- Audio source references are validated against the same project asset graph used by mesh/material references.
- Audio remains presentation-only and browser autoplay policy remains explicit.
- The feature cannot be considered complete until Editor save/load and Player playback both consume the same persisted component contract.

## Alternatives rejected

- **Add `AudioSource` under `1.0.0` without schema evolution:** rejected because the component has no typed validation or default migration path.
- **Store a URL or filesystem path in the component:** rejected because source location is project-storage-owned and not a stable asset identity.
- **Autoplay immediately on project load:** rejected due to browser gesture requirements and surprising playback.
- **Require a `MeshRenderer` for audio entities:** rejected because audio-only scene entities are valid and common.
