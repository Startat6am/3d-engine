# Milestone 3 — Core & ECS runtime acceptance

## Scope delivered

- `EngineRuntime` owns a `World`, `TransformHierarchy`, `SystemScheduler`, fixed-step `EngineClock`, and `EventBus`.
- Each frame runs `pre-update`, zero or more `fixed-update` steps, `variable-update`, `post-update`, and `transform-propagation` in that order.
- Fixed-update systems receive the configured fixed delta; frame phases receive the clamped frame delta.
- Deferred world mutations are flushed by the scheduler after each phase.
- Transform propagation runs after simulation phases and exposes defensive copies of world matrices.
- The browser player now creates renderable entities in ECS, advances `EngineRuntime` on `requestAnimationFrame`, and builds the render scene from propagated ECS world transforms.

## Verification

- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 47 tests passed across 7 files.
- `pnpm --filter @engine/player build` — passed.
- `pnpm --filter @engine/editor build` — passed on the current `main` baseline.
- `pnpm exec playwright test --workers=1` — 7 editor browser E2E tests passed. The default 7-worker run exceeded the available browser resources and Chromium targets crashed; serial execution passed.
- Player browser smoke test with Chromium/SwiftShader — canvas present, WebGL2 context available, no page errors.

## Known limitations

- The player acceptance scene is intentionally a single box; this milestone does not introduce geometry or renderer features beyond the existing baseline.
- `EngineRuntime` is a deterministic frame/phase orchestrator, not a complete game loop policy: application-specific pause, time scaling, input, and render interpolation remain future work.
- Runtime events are exposed through `EventBus`; the runtime currently emits `runtime:frame` once per advanced frame.
- Physics, assets/serialization integration, editor save/load, and packaging remain in their roadmap milestones.
