# Geometry & Renderer implementation status

**Status:** first reusable geometry and renderer contract slice implemented. This is not yet a complete rendering pipeline.

## Geometry

`@engine/geometry` exposes CPU-only `MeshData` buffers (`Float32Array` positions/normals and `Uint32Array` triangle indices), validation, and parameterized Box, Plane, UV Sphere, Cylinder and Cone primitives. Dimensions and segment counts are validated. Geometry is independent of DOM and renderer packages.

## Renderer contract

`@engine/renderer` exports engine-owned descriptors for perspective/orthographic cameras, materials, render objects, render scenes, capabilities, errors and lifecycle. `RendererAdapter` is the backend boundary; Three.js implementation types do not escape the package API. `createRenderer(canvas)` currently selects the WebGL2 adapter and fails with a typed error when WebGL2 cannot be initialized.

The adapter supports scene submission, per-object geometry/material/transform synchronization, resize, camera projection selection and idempotent disposal. GPU geometry/material objects are released when render objects are removed or the adapter is disposed.

## Integration

Editor and Player now submit the same immutable-shaped `RenderScene` descriptor to the renderer contract. They no longer call a backend-specific `setMeshes()` API.

## Not yet implemented

- Renderer frame extraction directly from ECS World and Transform world matrices
- Dirty GPU buffer updates and explicit geometry/material resource handles
- Frustum culling, batching, instancing and LOD
- PBR texture maps, shadow maps, post-processing and environment lighting
- GLTF/GLB loading and texture/asset pipeline
- Context loss/recovery and visual regression matrix across browsers/GPUs
- WebGPU adapter (remains gated by architecture spec)

## Verification

Geometry and renderer descriptor tests run headlessly. Editor and Player production builds validate the public adapter contract. Browser WebGL2 smoke testing remains part of the PR CI gate; a local build alone does not prove GPU behavior on all devices.
