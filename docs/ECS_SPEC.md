# ECS and Scene Graph Specification

**Status:** proposed baseline.

## Responsibility

ECS owns entity identity, component data, queries, and system execution. Spatial hierarchy is represented by Transform parent/child relationships; it does not replace ECS ownership.

## Data model

- Entity IDs are opaque generation-safe handles; stale IDs are rejected.
- Component types are registered with stable IDs and schema metadata.
- Component storage is selected per type (dense packed storage for hot built-ins; sparse/pool storage where sparse membership is appropriate).
- Systems declare read/write access and execution phase.
- Structural changes during iteration are deferred to explicit command-buffer playback points.

## Transform hierarchy

Transform stores local position, quaternion rotation, scale, and optional parent entity ID. World matrices are derived and cached. Parent changes validate cycles and missing parents. Destroy policy is explicit: detach children or recursively destroy, selected by API call. Non-uniform scale and shear limitations must be documented for physics/render adapters.

## Scheduling

Initial phases: pre-update, fixed-update, variable-update, post-update, transform propagation, extraction. Fixed simulation step is independent from render cadence. Systems have deterministic ordering by declared phase and registration order initially; dependency scheduling may be added when necessary.

## API sketch

```ts
type EntityId = string & { readonly __brand: 'EntityId' };
interface System {
  readonly phase: SystemPhase;
  update(ctx: SystemContext): void;
}
interface EntityQuery<T> {
  forEach(fn: (entity: EntityId, ...components: unknown[]) => void): void;
}
```

## Dependencies

Core has no external renderer, physics, React, or DOM dependencies. Feature systems use core query and event contracts.

## Performance

Avoid per-entity object allocation in hot loops; use packed component arrays and query iteration. Benchmarks cover 1k/10k/100k entities and varied component densities; report memory and update time, not invented FPS.

## Errors and tests

Test ID reuse/staleness, structural mutation during iteration, query membership, hierarchy cycles, parent deletion, deep trees, transform invalidation, and deterministic ordering.

## Acceptance

Core runs in Node/headless tests; entity lifecycle and hierarchy behavior are specified and covered; renderer/physics do not own canonical transform state.
