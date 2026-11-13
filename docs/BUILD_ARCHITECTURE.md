# Browser Build and Runtime Boundaries

This document defines the browser-app build boundaries. It is an architectural contract, not just a Vite optimization note.

## Package ownership

- `@engine/core`, `@engine/geometry`, `@engine/assets`, and `@engine/serialization` are renderer-independent. They must not import Three.js, browser renderer implementations, or format-specific decoders.
- `@engine/renderer` owns the Three.js implementation. Its `contracts` entry is the backend-neutral scene/renderer contract; Three.js implementation details must not escape through public types or app code.
- `@engine/gltf-importer` owns GLB parsing and meshopt decompression. It must not be a dependency of the Player runtime. Format decoders are loaded with the importer, not by Core or Renderer.
- `apps/editor` is an authoring application. It may load importers and diagnostics tooling on demand.
- `apps/player` is the runtime shell. It consumes engine contracts and the renderer adapter, not Three.js APIs directly.

## Loading policy

- Editor loads `@engine/renderer` when its viewport initializes and loads `@engine/gltf-importer` only when a GLB import is requested.
- Player loads the renderer at startup because rendering is required to run the scene. It does not load authoring/import code.
- Player passes the propagated column-major world matrix through `RenderObject.worldMatrix`. Backend-specific matrix operations remain inside the renderer adapter.
- Three.js is a single versioned workspace catalog dependency and a separate `vendor-three` chunk in both browser apps. `meshoptimizer` is a separate `vendor-meshoptimizer` chunk, reachable only through the GLB importer path.
- The shared Vite chunk policy lives in `vite.shared.ts`; app configs must not independently invent vendor chunk names or version boundaries.

## Compatibility invariants

1. No Three.js import in Core, Geometry, Assets, Serialization, GLTF Importer, or Player application source. Runtime Three.js use is limited to the Renderer adapter and the Editor's GLB node-transform flattening path; no Three.js objects enter scene contracts or serialized data.
2. No GLTF importer or meshopt decoder in Player's dependency graph.
3. Editor must preserve the dynamic import boundaries for Renderer and GLB Importer.
4. Player's renderer-neutral scene data must remain sufficient for another renderer backend; no Three.js object instances may cross the adapter boundary.
5. Three.js runtime and type package versions are pinned through the pnpm workspace catalog.
6. Production builds must keep renderer and decoder chunks independently cacheable. Review gzip sizes and the emitted import graph when dependencies change; do not silence size regressions by arbitrarily raising warning limits.\n7. MeshData is an immutable snapshot after ingestion. Validate each geometry object once, when it is first introduced or replaced, not on camera frames or resize. Camera-only updates reuse the same render-object snapshot; resize calls are no-ops when the physical viewport dimensions are unchanged.

## Current production build baseline

Measured with Node 22.23.4 and pnpm 12.18.0 on this branch:

| App / chunk          |  Minified |      gzip | Loading                  |
| -------------------- | --------: | --------: | ------------------------ |
| Editor app entry     | 395.28 KB | 124.50 KB | Initial                  |
| Editor Three.js      | 753.31 KB | 192.54 KB | Viewport renderer import |
| Editor meshoptimizer |  26.48 KB |   7.26 KB | GLB import path          |
| Player app entry     |  23.74 KB |   8.55 KB | Initial                  |
| Player Three.js      | 521.18 KB | 129.27 KB | Initial runtime renderer |

These are build artifacts, not claims about exact production transfer size; hosting compression and browser cache affect transfer. The Three.js raw chunk exceeds Vite's default 500 KB warning threshold while its gzip size is about 193 KB. The shared config sets an 800 KB raw threshold with limited headroom; the gzip figures above remain the review metric. A build-time plugin also fails production builds if the app entry exceeds 160 KiB gzip, Three.js exceeds 220 KiB gzip, or meshoptimizer exceeds 20 KiB gzip.
