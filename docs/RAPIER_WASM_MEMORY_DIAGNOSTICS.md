# Rapier WASM Memory Diagnostics

**Status:** instrumentation added; exact WASM linear-memory measurement remains unavailable through the public engine adapter.

## What the browser benchmark reports

`apps/player/physics-benchmark.html` captures three snapshots:

1. Before Rapier initialization.
2. After creating and disposing the initialization probe.
3. After the sparse and dense workloads have completed and their physics worlds have been disposed.

Each snapshot reports the optional Chromium/V8 `performance.memory` JS-heap counters and, when available, `performance.measureUserAgentSpecificMemory()` for the whole page. The latter requires a secure, cross-origin-isolated context; otherwise the report records whether the API is unsupported, isolation is missing, or measurement failed.

The Player Vite development server sets same-origin COOP and require-corp COEP headers for the benchmark context, and the Playwright test asserts `crossOriginIsolated === true`. This makes the whole-page API measurable where the browser implements it; it does not add Rapier-specific attribution.

## Important attribution boundary

The Rapier 0.21 JavaScript adapter does not expose the underlying `WebAssembly.Memory` instance through the public `@dimforge/rapier3d` API used by this project. Consequently:

- `wasmLinearMemoryBytes` is deliberately `null`.
- `not-exposed-by-public-rapier-api` is a capability status, not a zero-byte measurement.
- JS heap counters do not include WASM linear memory.
- User-agent-specific memory is a whole-page estimate. It must not be presented as Rapier-only WASM usage, nor as GPU/VRAM usage.
- A before/after snapshot is not a leak proof. Memory may remain reserved by the runtime after object disposal, and reclamation may depend on garbage collection and allocator behavior.

Do not add private Rapier glue imports or inspect generated wasm-bindgen internals merely to force a number into the report. If exact linear-memory telemetry becomes an acceptance requirement, use a deliberately supported instrumentation seam (for example, an upstream-supported memory export or a maintained instrumented Rapier build) and validate that it measures the same WASM instance used by the production backend.

## Verification

The Playwright browser benchmark test asserts that the report explicitly identifies the unavailable exact-WASM metric and emits the three lifecycle snapshots. It accepts all documented states for the optional whole-page memory API. The test does not assert a memory budget or claim that disposal returns WASM memory to the operating system.

The existing browser benchmark remains a headless Chromium physics microbenchmark. Physical-device/browser profiling and an owner-approved memory budget remain separate M6 acceptance gates.
