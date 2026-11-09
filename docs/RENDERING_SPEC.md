# Rendering Specification

**Status:** proposed baseline.

## Responsibility
Render world snapshots without owning gameplay state, ECS storage, or editor UI.

## Backend decision
Three.js is the initial graphics implementation adapter. Engine-facing contracts must not expose Three.js classes. WebGL 2 is the first supported baseline. WebGPU is a separately isolated backend, gated on stable browser availability, feature parity, conformance tests, and measured value; no critical core API depends on experimental WebGPU features.

## Features and staged support
Initial: perspective/orthographic cameras, mesh rendering, basic PBR material mapping, directional/ambient lighting, frustum culling, resize and resource disposal. Later: shadows, instancing, LOD, post-processing, voxel batches/chunks, clustered lighting and GPU-driven paths when justified.

## Contracts
Renderer consumes immutable/interpolated render data extracted from the world. Geometry is CPU-side engine geometry; backend resources are opaque handles. Capability queries describe texture formats, limits, shadow modes, instancing, and optional features. Backend selection may fall back without changing scene data.

## Dependencies
Core + geometry contracts; Three.js adapter; asset pipeline for decoded textures/material inputs. No React or physics dependency.

## Performance
Track draw calls, visible objects, triangles, material switches, upload bytes, CPU submission time, GPU timings when available, and estimated GPU memory. Avoid per-frame GPU resource creation. Culling and instancing decisions are benchmark-driven.

## Errors and recovery
Context/device loss transitions renderer into a recoverable unavailable state; notify host and allow resource recreation from retained CPU descriptors. Unsupported formats/features produce typed capability errors or documented fallback.

## Testing
Backend conformance suite, headless extraction tests, browser smoke tests on WebGL2, WebGPU tests only on supported CI hardware/browser, visual regression with tolerances, resource leak/disposal tests.

## Acceptance
Primitive, imported GLB, voxel, and mixed scenes render with equivalent world semantics; renderer can resize, lose/recreate backend resources, and dispose cleanly.
