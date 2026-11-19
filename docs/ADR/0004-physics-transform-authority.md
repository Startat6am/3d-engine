# ADR 0004: Physics and ECS Transform Authority

- **Status:** Proposed — initial integration tests pass; owner acceptance remains open
- **Date:** 2026-11-15
- **Decision owners:** Choreon maintainers

## Context

`engine-core` already provides `EngineClock`, fixed-update scheduler phases, mutable ECS `Transform` components, parent hierarchy, and transform propagation. Physics must integrate with these contracts without introducing a second clock or allowing renderer state to become authoritative.

The current transform model stores local TRS plus parent identity. Dynamic rigid-body synchronization through arbitrary parent transforms requires correct inverse-world decomposition and becomes ambiguous under non-uniform scale or shear.

## Proposed decision

Use the existing `EngineRuntime` clock and fixed-update phase as the sole simulation clock. Physics steps only from fixed ticks. Synchronize physics results into ECS before transform propagation and render extraction.

Authority by body type:

- **Static:** ECS Transform is authoritative. Transform edits update the physics pose before the next step.
- **Kinematic:** ECS/gameplay target is authoritative. The adapter receives a target pose for the next fixed tick.
- **Dynamic:** Physics simulation is authoritative. The resulting pose is written back to ECS after each fixed tick.

M6 conservative transform constraints:

- A rigid-body entity must be a root entity (`Transform.parent === null`).
- A rigid-body entity must use unit ECS scale; collider dimensions are specified explicitly in physics units.
- Unsupported parented bodies and non-unit scale are rejected with stable diagnostics, never silently approximated.
- Coordinates use the engine's right-handed, Y-up world convention; lengths are world units treated as meters for physics. Quaternion order is [x, y, z, w].
- Renderer interpolation, if implemented, is a presentation-only derived pose and never writes back to ECS Transform.

The root-only/unit-scale restriction is a deliberate M6 limit, not a permanent engine rule. A later contract revision may add parent-aware pose conversion after matrix inversion/decomposition and non-uniform-scale semantics are specified and tested.

## Phase ordering

For each rendered frame:

1. `pre-update`: `PhysicsPreUpdateSystem` validates ECS transforms and creates/removes backend bodies/colliders so handles exist before gameplay; `InputPreUpdateSystem` stages physical input.
2. For each fixed tick, `InputFixedUpdateSystem` publishes the snapshot before gameplay fixed systems.
3. Gameplay fixed systems submit forces/impulses and update kinematic ECS targets.
4. `PhysicsSystem` runs after gameplay fixed systems, submits static/kinematic poses, steps exactly once, drains collision events, and writes dynamic poses into ECS.
5. `variable-update` and `post-update`: non-authoritative presentation/gameplay work.
6. `transform-propagation`: rebuild derived world matrices; renderer extracts presentation state.

The exact relative order of gameplay fixed systems and physics sync must be explicit in scheduler registration/order tests; do not rely on incidental package registration order.

## Consequences

- ECS remains the serialized authoring model; backend state is rebuilt from descriptors.
- Dynamic bodies cannot currently be parented or scaled through Transform.
- The existing core clock remains the single source of fixed-step cadence.
- Future interpolation and editor gizmos must respect authority rules.

## Verification before acceptance

Test static edits, kinematic targets, dynamic writeback, root/scale validation, fixed-phase ordering, multiple fixed ticks, pause/single-step, entity destruction, and renderer extraction after synchronization.
