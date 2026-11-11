# Asset Pipeline Specification

**Status:** proposed baseline.

## Responsibility

Provide stable asset identity, source import, decoding, caching, dependency tracking, and explicit resource lifetime. Importers are adapters, not scattered loaders in features.

## Supported formats

**glTF 2.0 / GLB 2.0 is the primary interchange target for models.** GLB is the convenient single-file packaging of glTF resources; glTF JSON is useful when external or data-URI resources and human-inspectable manifests are needed. Neither is the Choreon project container. KTX2/Basis Universal is the intended path for compressed textures where supported; common image/audio formats use browser decoders. Additional model formats require a documented importer and license review.

The importer pool is intended to grow behind one format-neutral importer contract:

| Format         | Intended role                                   | Strategy / priority                                                                                                                              |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **.glb**       | Primary single-file model interchange           | Current initial importer target; support is limited to the capabilities documented by the implementation and fixtures.                           |
| **.gltf**      | JSON glTF with external or embedded resources   | Planned next extension of the glTF importer.                                                                                                     |
| **.blend**     | Native Blender project/source                   | Planned optional Blender-assisted conversion to GLB. Do not implement a native .blend parser in engine-core.                                     |
| **FBX**        | Common DCC and game-production interchange      | Planned evaluation after the glTF path; choose a maintained importer or controlled converter only after license, runtime, and deployment review. |
| **OBJ**        | Static mesh interchange                         | Optional lower-priority importer; not a character rig/animation interchange solution.                                                            |
| **USD / USDZ** | Composed scenes and larger production pipelines | Longer-term evaluation; substantially broader scene-composition scope than a basic model importer.                                               |

This is a direction, not a delivery schedule or a claim that these formats are currently supported. The current implementation status and unsupported glTF features are tracked in [Assets & Serialization Status](ASSETS_SERIALIZATION_STATUS.md) and must be kept accurate as code changes.

### Blender conversion boundary

A .blend file is a Blender project, not merely a mesh container. It may include scene collections, modifiers, procedural data, materials, rigs, animation, and Blender-specific features. The proposed path is an optional adapter that invokes a compatible Blender installation in a controlled background mode and exports a GLB intermediate. The adapter must:

- declare Blender as an optional external dependency with a detectable version/capability check;
- preserve the original source and never silently overwrite it;
- report conversion failures and feature loss with source context;
- define deterministic export settings and test fixtures;
- enforce time, memory, file-size, and output-path limits;
- keep Blender-specific code and process management outside engine-core.

The conversion path must not promise that every Blender feature survives glTF export. Imported capabilities are reported explicitly.

## Pipeline

Discover -> identify/hash -> validate -> import/decode -> normalize metadata -> cache CPU representation -> upload backend resources on demand -> track references -> dispose when unused. Import jobs are async and cancellable. Source files are not modified.

## Asset identity and registry

Stable AssetId independent of path; path/URI is project-relative. Registry stores type, content hash, importer/version settings, dependencies, and metadata. Cache keys include content hash and relevant importer settings. Import results are versioned to invalidate stale derived data.

## Resource lifecycle

CPU descriptors may outlive renderer device resources. GPU handles are backend-owned and recreated after device/context loss. Ownership is explicit; disposal is idempotent. Avoid implicit global caches with unbounded lifetime.

## Dependencies

Serialization defines persisted references. Asset IDs are unique within a world document; entity references, embedded source payloads, and dependency edges must resolve, and the dependency graph must be acyclic. Renderer consumes decoded geometry/material/texture data; animation/audio consume their respective asset types.

## Performance

Measure cold/warm import, decode time, upload time, cache hit rate, peak memory, and cancellation latency. Large decode/voxel jobs can move to workers behind the same job API.

## Errors and tests

Validate malformed assets, unsupported extensions, missing dependencies, hash mismatch, cancellation, cache invalidation, device loss, and disposal. Preserve useful source context in errors.

## Acceptance

Import a representative GLB with meshes/materials/animation; resolve referenced textures; reuse cached results; release resources deterministically; round-trip references through .world.

The editor resolves glTF `baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`, and `emissiveTexture` references to embedded PNG/JPEG texture assets. The renderer decodes them asynchronously and caches GPU textures by content hash and color space with reference-counted leases. Base-color/emissive maps use sRGB; metallic-roughness, normal, and occlusion maps use linear color space. glTF `TEXCOORD_0` is carried through mesh geometry and `.world` persistence, bound to UV0, and reused as UV1 for the core occlusion map. Removing an object or replacing/removing its material releases texture leases. Texture transforms, full glTF sampler/filter/wrap fidelity, per-channel normal scale and occlusion strength, alpha MASK cutoff, double-sided material behavior, UV sets beyond TEXCOORD_0, and WebGL context-loss recreation remain outside this rendering slice.
