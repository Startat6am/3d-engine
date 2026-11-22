# ADR 0012: Empty chunk authoring and shared voxel material catalog

**Status:** Accepted for M7 Editor authoring baseline
**Date:** 2026-11-21

## Context

The first Editor workflow created a chunk with a prefilled 16-cell grass strip. This made a storage/streaming unit look like a fixed-size terrain primitive and coupled the user's first interaction to one material. The engine already has a bounded 16³ cell snapshot, a per-chunk palette of stable material references, and a world-level voxel edge length.

## Decision

- Creating a chunk creates an empty 16 × 16 × 16 cell region. Empty cells are air (0) and empty chunks produce no mesh.
- Keep 16³ as the persisted v1 chunk storage and meshing unit. A larger world is composed from multiple chunks at signed integer coordinates. Do not expose arbitrary per-chunk dimensions until storage, meshing, neighbor borders, serialization, streaming budgets and migration semantics all support them together.
- Keep voxel edge length (voxelSize) independent and editable at world scope. It changes the world-space scale of cells without changing the number of cells in a chunk.
- Keep stable material definitions in a shared engine-level built-in catalog. New chunks start with an empty local palette; a selected material is added to that palette only on the first paint. Chunk palettes reference stable keys and cells store compact palette indexes; renderer objects and GPU resources never enter persisted voxel data.
- Ship the initial built-in catalog with Grass, Dirt, Stone, Sand, Wood, Snow and Water. Keep asset material references in the storage contract for future project-authored material assets.
- Do not claim custom texture import/assignment or a project-wide material asset browser is complete in this decision. Those require a material asset schema, texture sampler contract, renderer binding and round-trip tests.

## Consequences

- A newly created chunk has 8 KiB of zeroed cell data and no generated surface mesh; it no longer surprises users with a prefilled grass slab.
- Chunk dimensions remain predictable and bounded for the current codec and mesher. Users can build larger and irregular shapes by painting only occupied cells and placing additional chunks.
- The Editor's voxel-size control is explicitly world-wide. Changing it updates the scale of all voxel chunks.
- Material labels/colors have one source of truth in @engine/voxel; per-chunk palettes remain compact references and can contain only materials actually used.
- Arbitrary dimensions, voxel assembly grouping/transforms, custom material authoring and texture editing remain separate future capabilities rather than partial UI promises.

## Verification

Unit tests validate stable built-in keys and catalog lookup. Editor acceptance verifies that new chunks are empty, selected material is available for painting, voxel size changes world-space cell scale, and saved/reopened worlds retain chunk palettes and voxel settings.
