# Assets & Serialization Implementation Status

**Status:** initial package slice plus editor, GLB, cache, and renderer integration; milestone exit gate remains open.

## Delivered

- `@engine/assets`: project-scoped asset identity registry with typed asset kinds, normalized project-relative URIs, importer identity/settings, content hashes, metadata, dependency references, guarded removal, and a format-neutral importer dispatcher with cooperative cancellation.
- `@engine/gltf-importer`: GLB 2.0 parsing for embedded binary buffers, indexed/non-indexed triangle primitives, float and normalized integer POSITION/NORMAL/TEXCOORD_0 accessors, unsigned scalar indices, `EXT_meshopt_compression` decompression, `KHR_mesh_quantization`, generated normals, node TRS/matrix metadata, metallic-roughness material factors, embedded image bytes, samplers, textures, `KHR_texture_transform` (offset/rotation/scale), and all five core metallic-roughness PBR texture references. Textured primitives without TEXCOORD_0 and invalid texture indices produce typed diagnostics.
- GLB import has configurable source/decoded-buffer/geometry/texture/vertex/triangle budgets with typed `RESOURCE_LIMIT` diagnostics. Import metadata records payload sizes and parse/decode/build/total durations; generated normals accumulate directly in the final Float32Array rather than allocating a second Float64Array.
- Editor GLB import registers stable asset IDs and SHA-256 source hashes, preserves source GLB payload bytes in the `.world` document, and restores payloads only after checking asset identity and content hash.
- `@engine/serialization`: versioned `.world` envelope, published Draft-07 JSON Schema for v1, Ajv-backed runtime structural validation, deterministic key ordering, explicit migration registry, embedded source-payload shape, and shared semantic validation of entity-to-asset, payload-to-asset, and asset-dependency references (including duplicate IDs, missing dependencies, and cycles). The schema ships with the compiled package.
- `AssetResourceCache`: asynchronous and synchronous resource acquisition, shared leases, reference counting, retry after failed creation, and disposal after the final lease. The renderer uses it for geometry, material, and decoded GPU texture resources and releases leases on replacement, removal, and renderer disposal.
- Editor resolves glTF `baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`, and `emissiveTexture` references to embedded PNG/JPEG/WebP texture assets. The renderer asynchronously decodes them with `createImageBitmap`, uploads base-color/emissive maps as sRGB and data maps as linear textures, and deduplicates GPU resources by content hash plus color space. UV0 is carried through geometry and restored from `.world`; the renderer binds UV0 for color/data maps and aliases it to UV1 for the core occlusion map. Texture leases are released when a material changes, an object is removed, or the renderer is disposed; late decode completions cannot attach to removed objects.
- `.world` material data stores each referenced texture asset ID, not duplicated image bytes, and persists UV0 mesh data. Semantic validation rejects dangling references and references to assets that are not typed as textures. Browser E2E covers all five core PBR channel references, embedded PNG decode, UV persistence, payload preservation, and save/reopen continuity.
- Editor Save/Open uses the shared serializer. Browser E2E verifies GLB import, stable asset references, source-payload preservation, save/reopen, and asset identity continuity.
- Serialization tests include a versioned golden world fixture with an embedded model asset.
- GLB importer fixtures cover meshopt-compressed buffers and interleaved POSITION/NORMAL accessors (`byteStride` and accessor offsets), rejection of unsupported required extensions, preservation of optional extension declarations, and malformed accessor/bufferView ranges.

## Not yet delivered

- The v1 JSON Schema validates the stable document envelope and known record shapes while leaving extension/component payloads open. Cross-record invariants (unique IDs, reference resolution, acyclic dependencies) remain explicit semantic validation in TypeScript; the schema is not claimed to replace those checks.
- GLB external/data URI buffers and images, sparse accessors, non-triangle primitive modes, GLB v1, glTF JSON with external buffers, skins, morph targets, and animation channels remain unsupported. Broader conformance fixtures remain open beyond the current interleaved-accessor, extension-declaration, and malformed-range coverage.
- Core glTF sampler mag/min filters and wrap modes (repeat, mirrored repeat, clamp-to-edge) are applied. `KHR_texture_transform` offset/rotation/scale is applied independently per material channel. UV sets beyond TEXCOORD_0 are not imported; UV0 is currently reused for the core occlusion map. Per-channel normal scale and occlusion strength, alpha MASK cutoff, double-sided material behavior, and device/context-loss recreation remain unsupported.
- Cancellation is cooperative through `AbortSignal`; there is no worker-backed import job queue or mid-accessor interruption for synchronous parsing.
- Editor-specific entity/component conversion remains local to the editor. Asset references are not yet integrated into player packaging or AI authoring plans.
- No standalone binary project asset store or archive container exists; source GLB payloads are embedded in the `.world` JSON for the current workflow.

## Next gates

1. Expand GLB conformance fixtures beyond the current baseline, including extension-specific capability handling, alignment/bounds edge cases, and additional malformed inputs.
2. Expand schema coverage for component-specific contracts and add compatibility/conformance fixtures for schema evolution.
3. Add worker-backed cancellable import jobs when the job boundary is specified; preserve the current cooperative cancellation contract.
4. Add per-channel normal scale and occlusion strength, alpha MASK/double-sided material behavior, and verify texture recreation after WebGL context loss.
5. Keep player packaging and future AI authoring on the same asset identity/reference contracts.
6. Run full workspace format, lint, typecheck, unit tests, production builds, and browser acceptance before marking the milestone complete.
