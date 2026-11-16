# M6 Physics Performance Report — preliminary

**Date:** 2026-11-16  
**Status:** preliminary Node/Rapier microbenchmark; not an M6 performance acceptance sign-off  
**Benchmark:** [\`packages/engine-physics/bench/physics-performance.mjs\`](../packages/engine-physics/bench/physics-performance.mjs)

## Environment

- Runtime: Node.js 22.13.0; V8 12.4.254.21-node.22; pnpm 12.18.0.
- Platform: Linux x64 in a Vercel-hosted shared sandbox.
- Reported hardware: 2 vCPU, Intel Xeon Processor @ 2.90 GHz; approximately 4.49 GB host-visible memory.
- Physics: Rapier 0.21.0 through the engine adapter, using the \`@dimforge/rapier3d-compat\` WASM distribution for Node execution. This is not a browser production-WASM benchmark.
- The sandbox is virtualized/shared; CPU scheduling and memory pressure are not controlled. Results are directional and must not be treated as stable hardware baselines.

## Method

- Fixed step: 1/60 s.
- Scenarios: 100, 500, and 1,000 dynamic sphere bodies, each with one collider, plus one static box floor (body/collider totals shown below).
- Bodies use gravity \`[0, -9.81, 0]\`, radius 0.25, and \`canSleep: false\`; positions are distributed on a regular grid.
- Each scenario runs 120 warm-up steps, then measures 600 fixed steps individually. Collision events are drained every step.
- Each scenario executes 3,000 downward raycasts after the simulation run. Hit rate is recorded; timings include JavaScript call overhead.
- A separate event-pressure case creates 25 dynamic and 25 static sphere bodies at the same position, executes one step, then measures the event drain.
- Timing statistics are mean, median, p95, and max. Outlier max values are reported but are not representative of steady-state latency.

## Results

| Dynamic bodies | Total colliders | Creation (ms) | Fixed step mean (ms) | Fixed step median (ms) | Fixed step p95 (ms) | Raycast median (ms) | Raycast p95 (ms) | Ray hits |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 101 | 4.75 | 0.5613 | 0.3625 | 0.6782 | 0.0084 | 0.0118 | 100% |
| 500 | 501 | 18.25 | 1.1627 | 1.1064 | 1.6248 | 0.0032 | 0.0046 | 100% |
| 1,000 | 1,001 | 18.56 | 2.2020 | 1.9800 | 3.3944 | 0.0021 | 0.0034 | 100% |

The separate collision-event case produced 925 drained events from 50 bodies / 50 colliders. The measured physics step was 2.9361 ms and the subsequent event drain was 1.8143 ms. This measures event count and drain wall time, not the number/size of internal allocations.

Process memory snapshots after each scenario (RSS / V8 heap used / external / ArrayBuffers):

- 100 bodies: 224,497,664 / 19,345,304 / 5,171,408 / 65,770 bytes.
- 500 bodies: 411,611,136 / 18,359,584 / 7,071,952 / 65,730 bytes.
- 1,000 bodies: 287,744,000 / 22,175,816 / 9,496,824 / 65,770 bytes.

These snapshots are not a controlled memory comparison: garbage collection was not forced, scenarios ran sequentially in one process, and Rapier WASM linear memory is not separately attributed. They do not establish a memory budget or leak-free bound.

## Interpretation and limitations

- The observed p95 fixed-step cost rises from about 0.68 ms at 100 bodies to about 3.39 ms at 1,000 bodies in this sparse, mostly non-contacting workload. This is comfortably below a 16.67 ms simulation tick in this particular Node run, but is not a browser frame-time guarantee.
- Raycast latency is sub-millisecond in the observed runs. The small measured values are affected by timer granularity, JIT, cache state, and virtualization; do not extrapolate linearly or compare runs from different hosts without repeating the methodology.
- The main body scenarios intentionally produce no contact events; event cost is covered separately by the 925-event drain case.
- Event object allocation volume, WASM linear-memory high-water mark, browser process RSS, GPU memory, and allocation/GC profiles were not instrumented.
- No browser engine (Chromium/Firefox/WebKit), physical desktop, mobile device, or production deployment was benchmarked here. Browser-specific profiling and repeat runs on dedicated hardware remain open.
- No performance budget or acceptance threshold has been approved by the project owner; this report does not close the M6 performance gate.

## Reproduction

From the repository root, with dependencies installed and package builds complete:

\`\`\`sh
pnpm --filter "./packages/**" build
node packages/engine-physics/bench/physics-performance.mjs
\`\`\`

The script uses the compatibility Rapier package for Node and the adapter's test loader seam. It does not alter the production backend selection.

## Follow-up required for M6 acceptance

- Repeat on a named, dedicated desktop and at least one target browser; record CPU, OS, browser build, and power/performance mode.
- Profile memory with controlled GC snapshots and an explicit WASM-memory measurement strategy.
- Add an allocation profiler or adapter instrumentation before claiming collision-event allocation cost.
- Include dense-contact and query-heavy scenes representative of the Player Playground and intended user workloads.
- Obtain owner-approved performance budgets before marking the acceptance item complete.
