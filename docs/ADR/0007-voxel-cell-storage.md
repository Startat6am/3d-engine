# ADR 0007: Dense voxel cell storage and palette

**Status:** Accepted and implemented as the M7 initial representation; benchmark-gated for future replacement  
**Date:** 2026-11-19

## Decision

- Persist and expose immutable chunk snapshots with exactly 4,096 cells for schema v1.
- Use a dense unsigned 16-bit cell buffer as the initial representation. Cell value `0` means empty; values `1..N` index the chunk palette.
- Palette entries use stable material asset IDs or explicit built-in material descriptors. Arbitrary URLs, absolute paths and runtime object references are forbidden.
- Limit a chunk palette to 65,535 entries. Validate every non-zero cell index against the palette before meshing or persistence.
- Use X-fastest linearization from ADR 0006.
- Edits create a new snapshot/revision rather than mutating a buffer already consumed by meshing. Report changed cell bounds/regions for downstream invalidation.
- The public contract specifies semantics, not a promise that every future implementation must retain a Uint16Array internally.

## Rationale and consequences

A dense 16³ Uint16 buffer is simple, deterministic and bounded at 8 KiB of raw cell data per chunk, excluding palette and object overhead. Sparse/hybrid storage is deferred until representative workloads demonstrate a meaningful benefit. The implementation must copy or otherwise safely own buffers at API boundaries to prevent caller mutation from invalidating snapshots.
