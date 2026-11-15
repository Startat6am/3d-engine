# ADR 0003: Isolate the Physics Backend Behind an Engine-Owned Adapter

- **Status:** Proposed — requires M6 compatibility spike and owner acceptance
- **Date:** 2026-11-15
- **Decision owners:** Choreon maintainers

## Context

M6 requires rigid-body simulation, collision events, queries, and browser deployment. The engine must retain ownership of entities, transforms, serialized scene data, and public contracts. A physics vendor's types and lifecycle must not become the engine's canonical world model.

Rapier is the current candidate because it provides a browser/WASM-capable rigid-body engine. Its exact version, distribution mode, license, browser compatibility, maintenance status, and bundle cost have not yet been verified for this repository.

## Proposed decision

Define an engine-owned `PhysicsWorld` contract and isolate the selected backend behind an adapter in `@engine/physics`.

The public boundary exposes engine-owned descriptors and values for:
- rigid-body type and configuration;
- collider shapes, dimensions, materials, and collision groups;
- lifecycle-safe body/collider handles;
- stepping and simulation controls;
- raycast/query results;
- collision events and filtering;
- structured errors and diagnostics.

The Rapier adapter is an implementation detail. No Rapier object, handle, enum, vector, event queue, or exception is exposed from public package exports.

## Consequences

**Positive**
- Backend can be replaced or supplemented without changing ECS, scene format, editor, or gameplay-facing APIs.
- A fake adapter can test lifecycle, synchronization, and query semantics independently.
- Serialization stores engine-owned configuration, never backend runtime objects.

**Costs and constraints**
- Adapter conformance tests and value conversion are required.
- Backend-specific capabilities may not map one-to-one; capability differences must be explicit.
- WASM initialization and disposal become explicit lifecycle concerns.

## Verification before acceptance

- Confirm exact Rapier package/version and license from authoritative project metadata.
- Verify browser support and WASM loading under Vite production build and supported deployment headers.
- Measure compressed and uncompressed bundle impact.
- Verify tree-shaking/code splitting so physics is not loaded by applications that do not enable it.
- Exercise startup failure, cancellation, repeated start/stop/dispose, body destruction, stale handles, raycasts, and event ordering.
- Compare adapter behavior against a fake backend conformance suite.

Until these checks pass, Rapier remains a candidate, not a pinned or accepted dependency.
