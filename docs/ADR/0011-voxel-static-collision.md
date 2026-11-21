# ADR 0011: Static voxel collision ownership and limits

**Status:** Accepted M7 scope boundary  
**Date:** 2026-11-19

## Decision

- Voxel chunks may optionally produce static triangle-mesh collider descriptors through the public `@engine/physics` API. `@engine/voxel` exposes `createVoxelChunkCollisionMesh`, which combines material parts into chunk-local positions/indices and enforces the physics default vertex/index budgets before backend allocation.
- Collision generation is explicit, bounded and tagged with the chunk revision plus all six neighbor availability/revision tokens. It is not implicit in rendering; the collision builder reuses deterministic exposed-face meshing.
- A collision resource is owned by the resident chunk and is removed on replacement, eviction or world disposal.
- Use existing PhysicsWorld triangle-mesh vertex/index limits and static-body restrictions. Reject over-budget data before backend allocation.
- Dynamic and kinematic triangle meshes, automatic mesh cooking and voxel-driven character-controller policy are excluded from M7.
- Collision rebuilds are invalidated by relevant voxel edits and published only when the source revision is still current.

## Consequences

The physics package remains unaware of voxel storage. The voxel package emits plain typed-array geometry only; Player/world integration must own static-body and collider creation, stale-result checks, replacement and disposal. M7 acceptance must test collider removal and stale-revision behavior; no performance budget is inferred without named hardware measurements.
