# Core & ECS implementation status

**Status:** initial headless implementation complete; transform propagation and dependency-aware scheduling remain follow-up work.

## Implemented contracts

- `World` owns entity lifetime and typed component stores. Destroying an entity removes all its components; stale entity IDs are rejected.
- Component types are created through `defineComponent<T>(name)` and have stable identity within the running process. Names are diagnostic labels, not serialized IDs.
- Component values are stored in dense arrays with sparse entity-to-index maps. Removal uses swap-remove; callers must not depend on iteration order after structural changes.
- `World.query(A, B, ...)` iterates the smallest matching store and intersects membership. Query callbacks receive the entity followed by component values in the requested type order.
- `World.defer` queues structural operations. `flushDeferred` applies the current batch in insertion order; operations enqueued while flushing are deferred to the next flush.
- `SystemScheduler` executes systems in registration order per phase and flushes deferred operations after each phase. Systems cannot be registered during an update or recursively update the scheduler.
- `EventBus` snapshots listeners before dispatch. Unsubscribe affects subsequent dispatches, not the active snapshot.
- `EngineClock` clamps large frame deltas, caps fixed substeps, drops excess whole-step backlog, and exposes interpolation alpha.
- `TransformHierarchy` validates parent existence and prevents cycles. Parent deletion can detach direct children or recursively destroy descendants.

## Current API entry point

All initial contracts are exported from `@engine/core`. See `packages/engine-core/src/ecs.ts` and its tests for exact TypeScript signatures.

## Deliberate limitations

- Component type IDs are runtime symbols; persistent schema IDs and component registration/migration belong to the serialization milestone.
- Query iteration currently passes object values. Packed scalar columns, typed-array specializations and query caching require benchmark evidence.
- Transform stores local position/quaternion/scale and parent identity. `TransformHierarchy.worldMatrix` composes a fresh column-major world matrix on demand, avoiding stale-cache bugs from direct component edits. Dirty flags/caching, keep-world reparenting, shear policy and optimized propagation remain future work.
- Scheduler ordering is phase plus registration order; read/write dependency graphs and parallel execution are out of scope for this step.
- The clock reports fixed-step count; a later engine loop will invoke fixed-update once per returned step and variable-update once per frame.
- Structural commands are explicit via `defer`; no implicit mutation lock is applied around query callbacks.

## Verification

Headless Vitest coverage includes entity/component lifecycle, sparse swap-removal, query intersections, deferred commands, scheduler order, event unsubscribe, capped clock behavior, hierarchy cycles, detach policy and recursive deletion.
