# Assets & Serialization Implementation Status

**Status:** initial package slice; milestone exit gate remains open.

## Delivered in this slice

- `@engine/assets`: project-scoped asset identity registry with typed asset kinds, normalized project-relative URIs, importer identity/settings, content hashes, metadata, dependency references, and guarded removal.
- `@engine/serialization`: versioned `.world` document envelope, structural validation, deterministic key ordering, explicit migration registry, and parse/serialize APIs.
- Unit tests for registry identity, URI traversal rejection, dependency integrity, document round-trip, malformed JSON, and migration behavior.

## Explicitly not delivered

- `@engine/gltf-importer` now parses GLB 2.0 containers, embedded binary buffers, indexed/non-indexed triangle primitives, float POSITION/NORMAL accessors, unsigned scalar indices, generated normals, node TRS/matrix metadata, and core metallic-roughness material factors. It is registered in the workspace and implements the format-neutral importer contract.
- GLB import currently retains embedded texture/image metadata and texture indices only; it does not decode pixels or upload GPU resources. External/data URI buffers and images, sparse/normalized accessors, non-triangle primitive modes, GLB v1, glTF JSON with external buffers, skins, morph targets, and animation channels are not supported. Cancellation is checked at importer boundaries and between mesh parses; synchronous parsing cannot be interrupted mid-accessor. No concrete async worker queue, texture/audio importer, content hashing implementation, cache, dependency scanner, or CPU/GPU resource retain/release lifecycle exists.
- No JSON Schema artifact or generated runtime validators yet.
- Editor Save/Open now calls `@engine/serialization` for envelope validation, parsing, and deterministic serialization; conversion of editor-specific entity payloads remains local.
- Asset references are not yet integrated into Editor, Player, renderer resources, or AI authoring plans.

## Next gates

1. Add golden fixtures and expand editor-specific round-trip coverage through the shared serializer.
2. Expand GLB fixtures for interleaved accessors, embedded texture decoding, animation, and unsupported-extension diagnostics.
3. Add cancellable import jobs, content-addressed cache, dependency graph validation, and deterministic disposal.
4. Verify world round-trip with asset references and missing-asset diagnostics.
5. Run full workspace format, lint, typecheck, unit tests, production builds, and browser acceptance before marking the milestone complete.
