# ADR 0010: Voxel persistence and content-addressed chunk blobs

**Status:** Accepted; shared adapter extracted, voxel extension integration in progress
**Date:** 2026-11-19

## Context

The existing world document envelope is versioned and supports an extensible `extensions` object. The content-addressed project asset store writes immutable SHA-256-addressed binary blobs before replacing `worlds/main.world` manifest-last. The implementation has been extracted from `apps/editor` into the shared `@engine/project-storage` package; the Editor retains a deprecated compatibility re-export.

## Decision

- Store voxel world metadata/chunk descriptors under the namespaced world extension `com.choreon.voxel-world`; do not add voxel-specific fields to generic ECS entities or the serialization envelope.
- Persist schema version, world settings, chunk coordinate, chunk revision, palette/material references, payload asset ID, byte length and SHA-256 content hash.
- Store cell bytes as immutable content-addressed binary blobs using existing project-store semantics. Directory projects must not Base64-expand large chunk payloads in the manifest.
- Use the existing AssetRecord identity/reference model; initially classify raw chunk payloads as `other` assets with explicit voxel-chunk MIME/metadata until a dedicated asset kind is justified.
- The shared `@engine/project-storage` package owns the project file-store interface, memory and browser directory adapters, and content-addressed asset save/load operations; Player and engine packages may depend on this package rather than Editor internals.
- Save and verify all new blobs before atomically replacing the manifest. Loading validates paths, hashes, byte lengths, schema and references before publishing the world.
- Runtime jobs, residency, caches, renderer handles and physics handles are never serialized.

## Consequences

The world envelope remains format-stable and voxel data remains content-addressed. This ADR does not claim Player/Editor voxel persistence is implemented. The adapter extraction is complete; versioned voxel extension serialization, payload integration tests and Player/Editor wiring remain M7 work.
