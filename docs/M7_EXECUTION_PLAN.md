# M7 Execution Plan â€” World & Voxels

**Status:** ACTIVE â€” world/chunk core, deterministic CPU meshing, stale-result validation, cooperative meshing cancellation, and the bounded chunk scheduler and deterministic seeded generator hooks are implemented; repeated load/eviction lifecycle stress coverage and the shared `@engine/project-storage` package extraction are implemented; versioned voxel-world extension persistence and focused integration tests are implemented; Editor/Player wiring and broader M7 validation remain.
**Branch:** `feat/m7-world-voxels-main`  
**Base:** `main` (M6 integrated at `54def10255ca8fad661e0077b15c3332d6a390f3`).  
**Updated:** 2026-11-19

## Goal

Deliver a bounded world/chunk layer, validated voxel representation, deterministic CPU meshing, streaming lifecycle and deterministic procedural-generation hooks. Voxel content is one geometry provider and coexists with conventional mesh entities. AI authoring remains M10; multiplayer and unbounded/infinite-world claims are excluded.

## Phase 0 â€” contracts and decisions

- [x] Create a separate M7 branch.
- [x] Inspect core, geometry, assets, serialization, physics, Editor project storage and subsystem contracts.
- [x] Publish `VOXEL_WORLD_SPEC.md`.
- [x] Record package boundaries, coordinates, storage/palette, meshing/borders, streaming, persistence and static-collision decisions in ADRs 0005â€“0011.
- [x] Extract the content-addressed project file and asset store into shared `@engine/project-stora¶»§q«^