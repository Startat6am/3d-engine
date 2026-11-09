# Engine Specification

**Status:** proposed baseline, pending owner approval  
**Version:** 0.1.0-draft

## Purpose and product boundary
A reusable, browser-first 3D engine for interactive scenes, voxel and conventional geometry, procedural worlds, simulations, and games. The engine is a product/library; games are consumers, not its architecture.

## Scope
Core lifecycle and world ownership; ECS and transform hierarchy; renderer and geometry; asset import/cache; physics, animation, audio and input adapters; world streaming; editor; player runtime; versioned project serialization; testing and profiling.

## Non-goals for the first release
A bespoke DCC suite, networked multiplayer, deterministic lockstep, native console support, a proprietary model interchange format, and a promise of fixed FPS across unknown hardware.

## Product constraints
- TypeScript is the primary implementation language.
- Browser runtime is the initial target; desktop packaging remains possible through a host shell later.
- Renderer backends are isolated behind a stable engine-facing contract.
- glTF 2.0/GLB is the model interchange format; KTX2/Basis is the texture delivery path.
- Voxel content is one geometry provider, never a special case in ECS or gameplay APIs.
- Editor and player consume the same engine packages; editor-only dependencies must not leak into player bundles.

## Quality attributes
Modularity, testability, explicit resource ownership, deterministic serialization, observability, graceful capability fallback, and measured performance. Performance targets are established from representative benchmark hardware and workloads before optimization claims are made.

## Error policy
Public APIs return typed failures for expected I/O, parsing, capability, and lifecycle errors. Programmer errors fail fast in development. Errors include subsystem and asset/entity context; secrets and user content are not logged by default.

## Dependencies
See [Architecture](ARCHITECTURE.md) and [ADRs](ADR/). Runtime dependency versions are selected and pinned during Foundation after compatibility spikes against current official documentation.

## Acceptance criteria
- Empty, primitive, GLB, voxel, mixed, physics, and animated-character examples run through the player.
- Editor can author, inspect, save, and reopen a representative world.
- A versioned world document survives round-trip and migration tests.
- All public packages expose documented entry points and automated API/type tests.
- Benchmark suite records CPU, GPU where available, memory, draw calls, load, and serialization metrics.
