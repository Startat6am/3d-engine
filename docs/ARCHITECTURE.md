# Architecture

**Status:** approved baseline.

## Package topology

```
apps/editor       React + TypeScript authoring shell
apps/player       thin browser host and game bootstrap
apps/examples     executable acceptance scenes
packages/engine-core
packages/engine-renderer
packages/engine-geometry
packages/engine-assets
packages/engine-physics
packages/engine-animation
packages/engine-audio
packages/engine-input
packages/engine-world
packages/engine-serialization
packages/engine-agent-authoring
packages/engine-editor
specs/ docs/ tests/
```

The initial suggested layout is refined by adding `engine-geometry` and `engine-world`: geometry generation/processing is not voxel-only, and streaming/procedural world orchestration should not live inside the voxel package. `engine-agent-authoring` is also added as a provider-neutral editor integration package; it owns prompt task orchestration, typed plans, validation coordination and provider adapter contracts, not core simulation.

## Dependency direction

- `engine-core` owns IDs, lifecycle, world/entity/component contracts, transforms, events, clock, and service registration. It has no Three.js, React, DOM, Rapier, AI provider, or browser-global dependency.
- `engine-geometry` owns CPU-side mesh/primitive/procedural data and optimization.
- `engine-renderer` depends on core + geometry and owns renderer abstraction and backend adapters.
- `engine-assets` owns asset identity, import orchestration, cache, and resource lifetime; format adapters plug into it. The initial `AssetRegistry` slice is implemented; import orchestration/cache/resource lifetime remain open (see `ASSETS_SERIALIZATION_STATUS.md`).
- Physics, animation, audio, input, and world packages depend on core contracts and their own narrow adapters.
- Serialization maps stable data contracts to versioned files; it does not serialize runtime objects, GPU handles, closures, or physics engine internals. The initial `@engine/serialization` envelope validator, deterministic serializer, and explicit migration registry are implemented; Editor integration and migration fixtures remain open.
- `engine-editor` composes public engine APIs; `apps/editor` owns React UI. `apps/player` composes runtime services without editor code.
- `engine-agent-authoring` depends on editor command/undo contracts, serialization, component/asset registries, and a renderer preview interface. Provider SDK adapters are optional integrations and never dependencies of core or player.

No dependency from core to a feature package; no dependency from runtime packages to editor UI. Cross-package communication uses public contracts/events, not private imports.

## AI authoring trust boundary

Natural-language prompts are converted into versioned declarative operation plans. Plans are schema- and policy-validated, previewed, approved, and applied transactionally through editor commands. Model output is untrusted data, never executable code. The editor remains usable without an AI provider. See [AI Agent Authoring Specification](AI_AGENT_SPEC.md).

## ECS and spatial hierarchy

ECS owns entity identity, component storage, and system scheduling. A Transform component stores local transform and parent/child identity. World matrices are derived/cached by a transform system; the hierarchy is not a second ownership model. Structural mutations are queued or applied at defined synchronization points.

## Rendering boundary

The engine-facing renderer API describes resources, passes, capabilities, and frame submission. Three.js is an implementation adapter, not the public engine API. WebGL2 is the initial baseline; WebGPU is enabled only after backend parity and browser capability tests. Unsupported features are queried explicitly.

## Data and threading

Start single-threaded with data-oriented storage and measurable hot paths. Worker boundaries (asset decoding, voxel meshing, procedural generation) are introduced behind async job interfaces when profiling justifies them. SharedArrayBuffer is optional and never required for correctness.

## Performance and lifecycle

Every resource has an owner, retain/release or scoped lifetime, and idempotent disposal. Avoid per-frame allocations in measured hot paths. Instrument system timings, draw/dispatch counts, memory estimates, and asset load stages.

## Error handling and tests

Adapters normalize third-party errors into typed engine errors. Package tests enforce dependency boundaries, API exports, lifecycle/disposal, and adapter conformance. Integration tests exercise mixed geometry and backend capability fallback. Agent plans use deterministic mock providers in CI and test schema validation, approval policy, revision conflicts, atomic transactions, and undo.

## Acceptance

A dependency graph check proves the direction above; player bundle excludes React/editor/AI provider SDKs; a headless core test runs without DOM/WebGL; resource disposal and world round-trip tests pass.
