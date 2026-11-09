# Runtime Specification

**Status:** proposed baseline.

## Responsibility
Host game execution: initialize services, load world, run frame schedule, route input, step physics, extract/render, and dispose resources.

## Frame model
Accumulate wall-clock delta; clamp pathological pauses; run zero or more fixed updates; run variable update; propagate transforms; extract render data; render. Define pause, single-step, visibility/background behavior, and shutdown ordering. Rendering cadence is not simulation timestep.

## Startup and scene loading
Player accepts project/world entry point and runtime configuration. Asset dependencies resolve before dependent systems start. Loading reports progress and supports cancellation. Runtime does not import editor modules.

## Packaging
Initial output is a static web application with documented asset base path and deployment configuration. Desktop/native packaging is future scope and must not distort browser contracts.

## Dependencies
Core, renderer, assets, serialization, and enabled feature packages. Host owns DOM/canvas integration.

## Performance
Track startup, world load, frame CPU phases, memory, asset upload, and shutdown. No FPS target until benchmark hardware and workload are published.

## Errors
Startup failures unwind initialized services in reverse order. Scene load failures identify missing/invalid asset references. Runtime can present recoverable renderer/asset errors to host.

## Tests and acceptance
Player boots an empty world and each acceptance scene; pause/resume/step and visibility transitions are covered; no editor/React dependency appears in player production bundle.
