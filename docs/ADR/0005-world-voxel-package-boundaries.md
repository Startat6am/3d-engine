# ADR 0005: World and voxel package boundaries

**Status:** Accepted for M7  
**Date:** 2026-11-19

## Context

World partitioning, voxel payloads, geometry generation and rendering have different lifecycles. Putting chunk streaming or voxel-specific state in ECS, renderer or Editor would couple runtime contracts to one content representation.

## Decision

- `@engine/world` owns world settings, signed chunk identity/coordinates, chunk lifecycle, residency, bounded job orchestration and generator contracts.
- `@engine/voxel` (introduced when payload work begins) owns palette/material references, cell storage, validation, edit revisions and CPU meshing.
- `@engine/geometry` remains the shared renderer-independent `MeshData` contract.
- Renderer consumes ordinary geometry/material descriptors and does not inspect voxel buffers.
- Physics consumes explicit collider descriptors and does not inspect voxel buffers or schedule generation.
- ECS identity and Transform remain representation-agnostic; chunks are not entities by default.
- Editor and Player compose public packages; no React, DOM, Three.js, Rapier or app imports enter world/voxel packages.

## Consequences

This creates one-way dependencies and permits conventional meshes and voxel chunks to coexist. The voxel package is a separate package boundary, not yet implemented. The current `@engine/world` package remains intentionally small.
