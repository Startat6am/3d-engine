# Assets & Serialization Implementation Status

**Status:** initial package slice; milestone exit gate remains open.

## Delivered in this slice

- `@engine/assets`: project-scoped asset identity registry with typed asset kinds, normalized project-relative URIs, importer identity/settings, content hashes, metadata, dependency references, and guarded removal.
- `@engine/serialization`: versioned `.world` document envelope, structural validation, deterministic key ordering, explicit migration registry, and parse/serialize APIs.
- Unit tests for registry identity, URI traversal rejection, dependency integrity, document round-trip, malformed JSON, and migration behavior.

## Explicitly not delivered

- No glTF/GLB importer or decoder is wired yet.
- No texture/audio importer, async job queue, cancellation, content hashing implementation, cache, dependency scanner, or CPU/GPU resource retain/release lifecycle.
- No JSON Schema artifact or generated runtime validators yet.
- Editor Save/Open still uses its local v1 parser/serializer; it has not been migrated to `@engine/serialization`.
- Asset references are not yet integrated into Editor, Player, renderer resources, or AI authoring plans.

## Next gates

1. Integrate the shared world serializer into Editor Save/Open and add golden fixtures.
2. Add asset importer contracts and a GLB importer with fixtures for meshes, materials, textures, and animation.
3. Add cancellable import jobs, content-addressed cache, dependency graph validation, and deterministic disposal.
4. Verify world round-trip with asset references and missing-asset diagnostics.
5. Run full workspace format, lint, typecheck, unit tests, production builds, and browser acceptance before marking the milestone complete.
