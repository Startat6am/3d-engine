# ADR 0003: Isolate the Physics Backend Behind an Engine-Owned Adapter

- **Status:** Proposed — package, Vite build, and Chromium runtime smoke verified; deployment-header and owner acceptance remain open
- **Date:** 2026-11-15
- **Decision owners:** Choreon maintainers

## Context

M6 requires rigid-body simulation, collision events, queries, and browser deployment. The engine must retain ownership of entities, transforms, serialized scene data, and public contracts. A physics vendor's types and lifecycle must not become the engine's canonical world model.

Rapier 0.21.0 is selected provisionally. Production uses `@dimforge/rapier3d@0.21.0` (Apache-2.0) with Vite's WASM module plugin and an ESNext build target. The `@dimforge/rapier3d-compat@0.21.0` distribution is a development-only test dependency; it is not part of the production bundle. A Vite production smoke build emitted a separate ~1.17 MB WASM asset (~0.45 MB gzip) and a ~52 KB gzip lazy JS chunk. A Chromium smoke run loaded the production Rapier module, stepped a dynamic body 60 times, and completed a raycast. This confirms the tested Chromium/Vite path, not every supported browser or deployment environment.

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

- [x] Confirm exact Rapier package/version and Apache-2.0 license from package metadata.
- [x] Verify Vite production WASM asset emission and lazy JS chunking.
- [x] Measure compressed and uncompressed bundle impact.
- [x] Verify the standard WASM module loads and simulates in Chromium.
- [ ] Verify supported deployment headers and additional target browsers.
- [ ] Exercise startup failure/cancellation and repeated start/stop/dispose lifecycle paths.
- [ ] Compare adapter behavior against a fake backend conformance suite.

The exact package versions are pinned for the M6 spike. This ADR remains proposed until deployment-header/target-browser compatibility and owner acceptance pass. No Rapier types are exposed from `@engine/physics` public exports.
