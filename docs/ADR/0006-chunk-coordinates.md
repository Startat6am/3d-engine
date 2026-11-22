# ADR 0006: Chunk coordinates and dimensions

**Status:** Accepted for persisted chunk schema v1  
**Date:** 2026-11-19

## Decision

- World units are meters. Voxel edge length is an explicit finite positive `voxelSize` in world settings.
- Persisted schema v1 uses fixed chunk dimensions of **16 × 16 × 16** cells.
- Chunk coordinates are signed safe-integer triples. Local cell coordinates are integers in `[0, 15]`.
- World-to-cell conversion uses floor semantics; truncation toward zero is forbidden because it misclassifies negative positions.
- Cell linearization is X-fastest: `index = x + 16 * (y + 16 * z)`.
- Canonical chunk keys are locale-independent decimal triples `x,y,z`; no leading plus, leading zeros or negative zero.
- Chunk identity is world identity plus coordinate, not an ECS EntityId or filesystem path.
- Reject non-finite values and values outside JavaScript safe-integer range before allocation.

## Rationale and consequences

16³ is a small, fixed, easy-to-test baseline (4,096 cells per chunk). It bounds per-chunk work and avoids variable chunk layouts in the first persisted schema. Voxel size remains configurable per world. A future dimension change requires a schema migration; do not silently reinterpret existing data.
