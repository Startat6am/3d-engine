# Assets & Serialization Implementation Status

**Status:** initial package slice plus editor, GLB, cache, and renderer integration; milestone exit gate remains open.

## Delivered

- `@engine/assets`: project-scoped asset identity registry with typed asset kinds, normalized project-relative URIs, importer identity/settings, content hashes, metadata, dependency references, guarded removal, and a format-neutral importer dispatcher with cooperative cancellation.
- `@engine/gltf-importer`: GLB 2.0 parsing for embedded binary buffers, indexed/non-indexed triangle primitives, supported float POSITION/NORMAL accessors, unsigned scalar indices, generated normals, node TRS/matrix metadata, metallic-roughness material factors, embedded image bytes, samplers, textures, and material texture references. Unsupported primitive modes and invalid accessor references produce typed diagnostics.
- Editor GLB import registers stable asset IDs and SHA-256 source hashes, preserves source GLB payload bytes in the `.world` document, and restores payloads only after checking asset identity and content hash.
- `@engine/serialization`: versioned `.world` envelope, structural validation, deterministic key ordering, explicit migration registry, embedded source-payload shape, and shared validation of entity-to-asset, payload-to-asset, and asset-dependency references (including duplicate IDs, missing dependencies, and cycles).
- `AssetResourceCache`: asynchronous and synchronous resource acquisition, shared leases, reference counting, retry after failed creation, and disposal after the final lease. The renderer uses it for geometry/material resources and releases leases on replacement, removal, and renderer disposal.
- Editor Save/Open uses the shared serializer. Browser E2E verifies GLB import, stable asset references, source-payload preservation, save/reopen, and asset identity continuity.
- Serialization tests include a versioned golden world fixture with an embedded model asset.

## Not yet delivered

- No published JSON Schema artifact or generated runtime validators yet; runtime validation is currently implemented in TypeScript.
- GLB external/data URI buffers and images, sparse/normalized accessors, non-triangle primitive modes, GLB v1, glTF JSON with external buffers, skins, morph targets, and animation channels remain unsupported. Interleaved accessor coverage and broader conformance fixtures remain open.
- Embedded image bytes are decoded/preserved by the importer, but renderer texture creation/upload and full material texture rendering are not integrated.
- Cancellation is cooperative through `AbortSignal`; there is no worker-backed import job queue or mid-accessor interruption for synchronous parsing.
- Editor-specific entity/component conversion remains local to the editor. Asset references are not yet integrated into player packaging or AI authoring plans.
- No standalone binary project asset store or archive container exists; source GLB payloads are embedded in the `.world` JSON for the current workflow.

## Next gates

1. Expand GLB conformance fixtures for interleaved accessors, unsupported extensions, and additional malformed inputs.
2. Define JSON Schema artifacts and align generated/runtime validation with the TypeScript contracts.
3. Add worker-backed cancellable import jobs when the job boundary is specified; preserve the current cooperative cancellation contract.
4. Add texture upload/rendering and verify device/context-loss recreation and disposal.
5. Keep player packaging and future AI authoring on the same asset identity/reference contracts.
6. Run full workspace format, lint, typecheck, unit tests, production builds, and browser acceptance before marking the milestone complete.
