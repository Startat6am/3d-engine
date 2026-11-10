# Asset Pipeline Specification

**Status:** proposed baseline.

## Responsibility

Provide stable asset identity, source import, decoding, caching, dependency tracking, and explicit resource lifetime. Importers are adapters, not scattered loaders in features.

## Supported formats

glTF 2.0/GLB for models, materials, skinning and animation; KTX2/Basis Universal for compressed textures where supported; common image/audio formats through browser decoders. Additional formats require a documented importer and license review.

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
