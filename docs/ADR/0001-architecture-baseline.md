# ADR-0001: Modular browser-first engine architecture

- **Status:** Proposed — awaiting project owner approval
- **Date:** 2026-11-09

## Context
The product must support voxel and conventional geometry, simulations, and games without binding core gameplay to a renderer or a single content representation. The initial target stack is TypeScript and browser technology, but compatibility and API stability must be validated before dependencies are pinned.

## Decision proposed
1. Use a pnpm TypeScript workspace with separately published-capable packages and thin editor/player apps.
2. Keep core ECS/transform contracts free of renderer, React, DOM, and physics dependencies.
3. Treat the scene hierarchy as Transform relationships over ECS entities, not a second object ownership system.
4. Use Three.js behind an engine-owned renderer interface; WebGL2 is initial baseline, WebGPU is an isolated optional backend.
5. Use glTF 2.0/GLB for model interchange and KTX2/Basis for compressed texture delivery.
6. Use Rapier behind a physics adapter, subject to a compatibility/licensing spike.
7. Store projects/worlds as versioned JSON `.world` documents with stable asset IDs and pure migrations.
8. Add geometry and world packages so voxel functionality remains one provider among many.

## Consequences
The design adds explicit adapters and package boundaries, but allows backend replacement and headless core tests. Some data synchronization and serialization contracts must be designed carefully. WebGPU parity and multithreaded processing are not prerequisites for the first renderer release.

## Alternatives considered
- Three.js types as public API: simpler initially, but couples all clients and serialized/editor contracts to one renderer.
- Voxel-first world architecture: rejected because it makes conventional geometry a second-class citizen.
- glTF as project format: rejected because glTF does not define editor project settings, arbitrary ECS components, world hierarchy semantics, or project asset registry.
- WebGPU-only renderer: rejected due to browser/device support and API maturity risk.
- Immediate worker/SAB architecture: deferred until profiling demonstrates need.

## Validation required before acceptance
Confirm current stable versions and compatibility of TypeScript, Three.js, Vite, React, Vitest, Playwright, Rapier, glTF tooling and KTX2 transcoding; build small spikes for WebGL2 renderer lifecycle, Rapier WASM loading, and GLB import. Record exact versions and browser matrix in Foundation ADRs.

## Compatibility research snapshot (2026-11-09)
Official references reviewed for this draft:
- [Three.js WebGPURenderer manual](https://threejs.org/manual/pages/webgpurenderer): WebGPU renderer offers WebGL 2 fallback, but the manual still describes it as experimental and notes feature differences. Keep it isolated; WebGLRenderer remains the recommended path for pure WebGL 2 applications.
- [Vite guide](https://vite.dev/guide/): current guide states Node.js 20.19+ or 22.12+; use Node 22.x LTS for the initial deployment environment, then pin package versions in the Foundation lockfile.
- [Rapier JavaScript guide](https://rapier.rs/docs/user_guides/javascript/getting_started_js/): the JS package is WASM-backed and initialization is asynchronous; adapter lifecycle must account for async init and bundler/WASM packaging.
- [Khronos glTF Registry](https://registry.khronos.org/glTF/): current registry identifies glTF 2.0 (specification patch 2.0.1); it is a runtime asset delivery standard, not an authoring/project format.
- [KTX 2.0 / Basis Universal guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXDeveloperGuide.md): KTX2 is the container, Basis Universal ETC1S/UASTC are transmission encodings, and runtime transcoding targets GPU-native compressed formats.

Exact package versions are intentionally **not pinned** in this architecture-only iteration. Foundation must verify current stable releases, peer dependency ranges, browser support, licensing, and reproducible build compatibility before adding dependencies. Do not interpret this snapshot as a complete compatibility matrix.
