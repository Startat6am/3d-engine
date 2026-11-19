# M6 Real-Device Physics Profile Worksheet

**Status:** deferred follow-up; no physical-device measurements recorded. M6 functional closure does not depend on this worksheet.  
**Owner review:** the current deployed Physics Playground received an interactive Chrome review on 2026-11-19; the owner reported that everything was OK.  
**Purpose:** collect repeatable, comparable measurements on named hardware for a future performance-budget review; this worksheet is not a blocker to the owner-directed M6 functional closure.

## Scope and evidence boundary

This worksheet complements, rather than replaces:

- [Node/Rapier benchmark report](PHYSICS_PERFORMANCE_REPORT.md#repeatable-dense-contact-profile--2026-11-18)
- [Browser production-WASM benchmark](PHYSICS_PERFORMANCE_REPORT.md#browser-rapier-wasm-profile--2026-11-18)
- [M6 acceptance checklist](acceptance/M6_PHYSICS_INPUT.md)

The existing Node and headless Chromium numbers are synthetic/shared-runner diagnostics. Do not relabel them as physical desktop or mobile measurements. A run is eligible for the hardware gate only when its device, OS, browser, power mode, build/commit, and test conditions are recorded.

## Before running

1. Use a clean checkout of the exact commit being evaluated and install with the repository's pinned pnpm version.
2. Build the workspace packages so the browser dev page resolves the current engine packages:
   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter "./packages/**" build
   ```
3. Start the Player Vite development server:
   ```sh
   pnpm dev:player
   ```
4. Open the dev-only benchmark page in a normal, foreground Chrome/Chromium tab: `http://localhost:5173/physics-benchmark.html`. If Vite reports another port, use the URL it prints.
5. Wait for **BENCHMARK COMPLETE** and save the full JSON from the results panel. Do not use the production deployment for this development-only route.
6. Run three independent browser contexts/runs where practical. Reload between runs; note whether the run is cold (first WASM initialization) or warm. Do not run DevTools CPU throttling unless it is an explicitly documented scenario.
7. Repeat on the desktop and at least one target device. For a mobile/tablet browser, record the exact Chrome version and device model; remote debugging is acceptable, but do not infer physical GPU or memory from emulation.

## Capture this environment for every run

| Field                                     | Value |
| ----------------------------------------- | ----- |
| Date/time and timezone                    |       |
| Device manufacturer/model                 |       |
| CPU model / core count                    |       |
| RAM                                       |       |
| GPU model                                 |       |
| OS version / build                        |       |
| Browser name and full version             |       |
| Browser channel (Stable/Beta/Dev)         |       |
| Power mode / plugged in or battery        |       |
| Display resolution / refresh rate         |       |
| Viewport dimensions / device scale factor |       |
| Foreground tab; other workload closed?    |       |
| Repository commit SHA                     |       |
| Benchmark page URL                        |       |
| Run number (1, 2, 3) / cold or warm       |       |

## Record from the JSON report

For each run, retain the raw JSON and copy these values into the report:

- Rapier WASM initialization time.
- Sparse 100 / 500 / 1,000-body scenarios: body/collider count, creation time, fixed-step median/p95/max, raycast median/p95/max, drained event count.
- Dense 216-body scenario: creation time, fixed-step median/p95/max, raycastAll median/p95/max, total events, steps with events, maximum events in one step, disposal time.
- Memory diagnostics before WASM initialization, after initialization/disposal, and after all scenarios/disposal. Record whether `measureUserAgentSpecificMemory()` was available and whether the page was cross-origin isolated.
- Any browser warnings, page errors, thermal throttling, dropped frames, or unexpected backgrounding.

The public Rapier API does not expose its WASM linear-memory high-water mark in this harness. A null `wasmLinearMemoryBytes` is expected and must not be converted into a zero-memory claim. JS heap and `measureUserAgentSpecificMemory()` are not GPU-memory measurements.

## Separate full-Playground observation

The benchmark page isolates physics and does not include ECS synchronization, scene extraction, WebGL rendering, or a full game frame. On the same device, open the current Physics Playground and observe a repeatable scene run:

- Record browser FPS counter and any visible stutter during idle, continuous movement, jump/landing, pause/resume, and reset.
- Keep the same viewport, display refresh rate, power mode, and browser foreground state between runs.
- If using Chrome DevTools Performance, export the trace and record CPU throttling (normally disabled), capture duration, and whether screenshots/advanced paint instrumentation were enabled.
- Do not interpret FPS alone as physics-step time; use the benchmark JSON for fixed-step timings.
- Note whether the device becomes warm or throttles during a longer run. Record duration and conditions rather than guessing temperature.

## Results table

Add one row per independent run; do not average away outliers before recording raw observations.

| Device / run      | Commit | WASM init ms | Sparse 1k fixed-step p95 ms | Dense fixed-step p95 ms | Dense events | JS heap after scenarios | UA memory bytes/status | Playground FPS / notes |
| ----------------- | ------ | -----------: | --------------------------: | ----------------------: | -----------: | ----------------------: | ---------------------- | ---------------------- |
| Desktop / 1       |        |              |                             |                         |              |                         |                        |                        |
| Desktop / 2       |        |              |                             |                         |              |                         |                        |                        |
| Desktop / 3       |        |              |                             |                         |              |                         |                        |                        |
| Target device / 1 |        |              |                             |                         |              |                         |                        |                        |
| Target device / 2 |        |              |                             |                         |              |                         |                        |                        |
| Target device / 3 |        |              |                             |                         |              |                         |                        |                        |

## Interpretation rules

- Compare repeated runs on the same device/build first. Do not compare ARM and x64 or different browser versions as if they were identical test conditions.
- Report median and range across independent runs; preserve each raw run and the p95/max within each run.
- A 1/60-second physics tick has a nominal 16.67 ms interval, but this is not an approved per-step budget. Do not declare a pass based on that number alone.
- Set performance budgets only after the owner reviews representative desktop and target-device results, full-Playground frame observations, and memory limitations.
- If memory stability is in question, add a separately designed repeated create/simulate/dispose test and browser/OS memory evidence. Do not claim a WASM memory ceiling from JS heap snapshots.
- Any engine/physics code change after the measured commit invalidates the profile for that new head; rerun the relevant scenarios.

## Future profiling sign-off (deferred; not an M6 exit gate)

- [ ] Named desktop profile recorded (3 runs).
- [ ] Named target-device profile recorded (3 runs).
- [ ] Full Playground observations recorded on both devices.
- [ ] Raw JSON and any Chrome Performance traces attached or linked.
- [ ] Outliers and thermal/background conditions reviewed.
- [ ] Owner-approved budgets documented in `PHYSICS_PERFORMANCE_REPORT.md`.
- [ ] M6 performance acceptance item updated with exact commit and evidence links.
