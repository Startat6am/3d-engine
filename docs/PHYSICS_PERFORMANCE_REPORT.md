# M6 Physics Performance Report — preliminary

**Date:** 2026-11-16  
**Status:** preliminary Node/Rapier microbenchmark; not an M6 performance acceptance sign-off  
**Benchmark:** [`packages/engine-physics/bench/physics-performance.mjs`](../packages/engine-physics/bench/physics-performance.mjs)

## Environment

- Runtime: Node.js 22.13.0; V8 12.4.254.21-node.22; pnpm 12.18.0.
- Platform: Linux x64 in a Vercel-hosted shared sandbox.
- Reported hardware: 2 vCPU, Intel Xeon Processor @ 2.90 GHz; approximately 4.49 GB host-visible memory.
- Physics: Rapier 0.21.0 through the engine adapter, using the `@dimforge/rapier3d-compat` WASM distribution for Node execution. This is not a browser production-WASM benchmark.
- The sandbox is virtualized/shared; CPU scheduling and memory pressure are not controlled. Results are directional and must not be treated as stable hardware baselines.

## Method

- Fixed step: 1/60 s.
- Scenarios: 100, 500, and 1,000 dynamic sphere bodies, each with one collider, plus one static box floor (body/collider totals shown below).
- Bodies use gravity `[0, -9.81, 0]`, radius 0.25, and `canSleep: false`; positions are distributed on a regular grid.
- Each scenario runs 120 warm-up steps, then measures 600 fixed steps individually. Collision events are drained every step.
- Each scenario executes 3,000 downward raycasts after the simulation run. Hit rate is recorded; timings include JavaScript call overhead.
- A separate event-pressure case creates 25 dynamic and 25 static sphere bodies at the same position, executes one step, then measures the event drain.
- Timing statistics are mean, median, p95, and max. Outlier max values are reported but are not representative of steady-state latency.

## Results

| Dynamic bodies | Total colliders | Creation (ms) | Fixed step mean (ms) | Fixed step median (ms) | Fixed step p95 (ms) | Raycast median (ms) | Raycast p95 (ms) | Ray hits |
| -------------: | --------------: | ------------: | -------------------: | ---------------------: | ------------------: | ------------------: | ---------------: | -------: |
|            100 |             101 |          4.75 |               0.5613 |                 0.3625 |              0.6782 |              0.0084 |           0.0118 |     100% |
|            500 |             501 |         18.25 |               1.1627 |                 1.1064 |              1.6248 |              0.0032 |           0.0046 |     100% |
|          1,000 |           1,001 |         18.56 |               2.2020 |                 1.9800 |              3.3944 |              0.0021 |           0.0034 |     100% |

The separate collision-event case produced 925 drained events from 50 bodies / 50 colliders. The measured physics step was 2.9361 ms and the subsequent event drain was 1.8143 ms. This measures event count and drain wall time, not the number/size of internal allocations.

Process memory snapshots after each scenario (RSS / V8 heap used / external / ArrayBuffers):

- 100 bodies: 224,497,664 / 19,345,304 / 5,171,408 / 65,770 bytes.
- 500 bodies: 411,611,136 / 18,359,584 / 7,071,952 / 65,730 bytes.
- 1,000 bodies: 287,744,000 / 22,175,816 / 9,496,824 / 65,770 bytes.

These snapshots are not a controlled memory comparison: garbage collection was not forced, scenarios ran sequentially in one process, and Rapier WASM linear memory is not separately attributed. They do not establish a memory budget or leak-free bound.

## Interpretation and limitations

- The observed p95 fixed-step cost rises from about 0.68 ms at 100 bodies to about 3.39 ms at 1,000 bodies in this sparse, mostly non-contacting workload. This is comfortably below a 16.67 ms simulation tick in this particular Node run, but is not a browser frame-time guarantee.
- Raycast latency is sub-millisecond in the observed runs. The small measured values are affected by timer granularity, JIT, cache state, and virtualization; do not extrapolate linearly or compare runs from different hosts without repeating the methodology.
- The main body scenarios produce no new collision-start events during the measured window after warm-up; bodies have already settled on the floor. Event-start/drain cost is covered separately by the 925-event stress case.
- Event object allocation volume, WASM linear-memory high-water mark, browser process RSS, GPU memory, and allocation/GC profiles were not instrumented.
- No browser engine (Chromium/Firefox/WebKit), physical desktop, mobile device, or production deployment was benchmarked here. Browser-specific profiling and repeat runs on dedicated hardware remain open.
- No performance budget or acceptance threshold has been approved by the project owner; this report does not close the M6 performance gate.

## Reproduction

From the repository root, with dependencies installed and package builds complete:

```sh
pnpm --filter "./packages/**" build
node packages/engine-physics/bench/physics-performance.mjs
```

The script uses the compatibility Rapier package for Node and the adapter's test loader seam. It does not alter the production backend selection.

## Follow-up required for M6 acceptance

- Repeat on a named, dedicated desktop and at least one target browser; record CPU, OS, browser build, and power/performance mode.
- Profile memory with controlled GC snapshots and an explicit WASM-memory measurement strategy.
- Add an allocation profiler or adapter instrumentation before claiming collision-event allocation cost.
- Include dense-contact and query-heavy scenes representative of the Player Playground and intended user workloads.
- Obtain owner-approved performance budgets before marking the acceptance item complete.

## Repeatable dense-contact profile — 2026-11-18

The benchmark now includes a deterministic dense-contact scenario in addition to the original sparse 100/500/1,000-body cases and collision-event drain stress case. The new scenario creates 216 dynamic spheres in a 6×6×6 pile (radius 0.25, 0.49-unit spacing) above a static floor, runs 120 warm-up ticks and 600 measured 1/60-second ticks, drains collision events every tick, and issues 3,000 `raycastAll` queries. It records per-step latency, event counts, point-in-time process memory, and adapter disposal time.

### Environment and repeatability

- Runtime: Node.js 22.23.5; V8 12.4.254.21-node.57 (within the repository's supported Node 22 range).
- Platform: Linux arm64 in the shared Vercel sandbox; 48 CPUs reported by Node, CPU model unavailable. This is not dedicated benchmark hardware.
- Three independent full-script runs were performed in the same environment. Values below show the observed range across runs, not a cross-machine guarantee.

### Results across three runs

| Scenario      | Bodies / colliders | Fixed-step median | Fixed-step p95 |                Ray query p95 |
| ------------- | -----------------: | ----------------: | -------------: | ---------------------------: |
| Sparse        |          100 / 101 |    0.190–0.192 ms | 0.218–0.232 ms |    raycast: 0.0068–0.0070 ms |
| Sparse        |          500 / 501 |    0.926–0.928 ms | 1.045–1.061 ms |    raycast: 0.0040–0.0042 ms |
| Sparse        |      1,000 / 1,001 |    1.567–1.581 ms | 1.692–1.710 ms |    raycast: 0.0035–0.0037 ms |
| Dense contact |          216 / 217 |    0.474–0.476 ms | 0.722–0.726 ms | raycastAll: 0.0039–0.0043 ms |

The dense-contact scenario drained exactly 1,708 collision events in each run, across 340 of 600 measured steps, with a maximum of 36 events in one step. Adapter disposal took 0.453–0.478 ms. These are measured adapter timings; they do not include ECS synchronization, browser scheduling, rendering, GPU work, or a complete game frame.

### Interpretation

- In this synthetic workload and shared ARM64 sandbox, measured p95 fixed-step time remained below 1.71 ms for the 1,000-body sparse case and below 0.73 ms for the 216-body dense-contact case.
- The dense-contact test now provides repeatable event-heavy coverage that the earlier settled sparse workload lacked. The separate 50-body event burst remains a one-step event-queue/drain microbenchmark.
- Do not compare these figures directly with the 2026-11-16 Linux x64 results: architecture, host scheduling, and runtime patch versions differ.
- Process memory values are point-in-time snapshots only. The script does not attribute Rapier WASM linear memory, profile allocations, measure GC pressure, or prove memory reclamation after disposal.

### Reproduction

```sh
npx --yes -p node@22 node packages/engine-physics/bench/physics-performance.mjs
```

This extends the Node/Rapier adapter evidence only. Browser/device profiling, controlled WASM/JS memory and allocation measurements, dedicated-hardware repeats, and owner-approved budgets remain open acceptance requirements.

### Verification of the benchmark extension — 2026-11-18

- Full repository `pnpm check` passed under Node.js 22.23.5 / pnpm 12.18.0: formatting, lint, typecheck, 180/180 Vitest tests, package builds, and Editor/Player production builds.
- The focused Chromium Physics Playground E2E passed (1/1) on this checkout. The full 22-test Playwright suite was attempted but did not complete successfully in this shared sandbox; do not infer a new full-suite pass from the earlier exact-head CI evidence.
- `git diff --check` and Prettier checks passed for the changed benchmark and documentation.
