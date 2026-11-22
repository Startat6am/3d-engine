# ADR 0008: Deterministic CPU voxel meshing and chunk borders

**Status:** Accepted and implemented M7 baseline  
**Date:** 2026-11-19

## Decision

- Initial meshing is exposed-face culling, not greedy meshing.
- Input is an immutable chunk snapshot plus immutable snapshots (or explicit unavailable markers) for its six face neighbors.
- Emit one geometry part per non-empty palette/material index. Each part contains validated `@engine/geometry` `MeshData` and its stable material reference.
- Omit faces adjacent to non-empty cells. Emit faces adjacent to empty cells.
- Treat an unavailable neighbor as provisional air so a newly loaded chunk has no holes at its outer boundary. Mark the result as dependent on that neighbor's availability/revision.
- Neighbor arrival, removal or revision change invalidates affected boundary faces on both sides.
- Results carry source chunk revision and six neighbor revision/availability tokens. Discard results if any token is stale at publication time.
- Keep the synchronous mesher as the deterministic baseline and expose a cooperative async entry point accepting `AbortSignal`. The async path yields between z-slices and rejects with `MESHING_ABORTED`; mutable intermediate geometry is private and no partial result is returned.
- Emit deterministic positions, outward normals, consistent triangle winding and valid Uint32 indices. Scale geometry by world voxel size.
- Empty chunks return an empty result without allocating vertex/index buffers.

## Implementation status

The current `@engine/voxel` mesher implements exposed-face culling, deterministic material-part ordering, outward normals/winding, UVs, voxel-size scaling, intra-chunk and loaded-neighbor culling, and neighbor revision tokens. The `isVoxelMeshResultCurrent` helper rejects output when source revision, neighbor revision/availability, or neighbor coordinates have changed. Tests cover empty/full chunks, adjacent cells/chunks, multiple materials, provisional boundaries, invalid neighbors, face winding, stale results, async/sync parity, pre-aborted jobs and mid-job cancellation. `meshVoxelChunkAsync` observes `AbortSignal` between z-slices and rejects without publishing partial geometry.

## Consequences

The first mesher is straightforward to verify and works without renderer knowledge. It may emit more vertices than greedy meshing; optimize only after benchmarks. Cancellation and stale-result rejection are required before asynchronous meshing is enabled.
