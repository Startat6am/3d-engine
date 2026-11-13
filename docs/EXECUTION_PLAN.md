# Choreon Execution Plan

**Last updated:** 2026-11-12  
**Repository:** `Startat6am/3d-engine`  
**Current milestone:** M5 — Assets & Serialization  
**Current focus:** GLB import reliability, resource limits, repeat-import behavior, and lifecycle verification.

This file is the durable handoff point for continuing work after a chat/session interruption. Update it whenever the active task, PR stack, verification state, or next step changes. `ROADMAP.md` remains the milestone-level plan; this file records the current execution slice.

## Current state

- M2 Foundation, M3 Core & ECS, and M4 Geometry & renderer baseline are complete.
- M5 is still in progress. Do not advance to M6 until the M5 exit gate in `ROADMAP.md` is met.
- GLB is the primary model interchange path. The current importer supports the documented static GLB subset, including meshopt compression, core PBR texture references, samplers, and `KHR_texture_transform`; consult `ASSETS_SERIALIZATION_STATUS.md` for exact limitations.
- The user tested their Momo GLB in the PR #46 Preview and reported that import/editor responsiveness improved substantially. This is qualitative acceptance feedback, not a reproducible memory/performance benchmark.
- User-uploaded test material is present on `main` under `dl-models-test/`: `Readme.txt` and `Momo_Ayase_Dandadan_concept_T-pose_v1.glb` (about 5.5 MiB). The README says this folder is for newly downloaded models. Keep private/user-supplied model binaries out of generated synthetic test fixtures and public benchmark artifacts unless explicitly approved.

## Active PR stack — all open, do not merge without explicit approval

| Order | PR | Branch | Base | Known head | Purpose |
|---|---:|---|---|---|---|
| 1 | [#44](https://github.com/Startat6am/3d-engine/pull/44) | `feat/glb-sampler-texture-transform` | `main` | `01a0fdbfefc56c4297b68a747ff4097a1f372374` | GLB sampler/texture transform, compressed asset support, diagnostics, editor/render performance fixes |
| 2 | [#45](https://github.com/Startat6am/3d-engine/pull/45) | `fix/glb-import-memory` | #44 branch | `42630a865b772192995f726e7713783152f75ea4` | Reduce peak memory in accessor decode, meshopt decompression, textures, and payload encoding |
| 3 | [#46](https://github.com/Startat6am/3d-engine/pull/46) | `feat/glb-import-budget` | #45 branch | `793c430afd28ff40f1e1712228143a94bc82f73a` | Configurable import budgets, typed resource-limit errors, diagnostics, typed-array allocation improvements |
| 4 | [#47](https://github.com/Startat6am/3d-engine/pull/47) | `feat/glb-import-stress-tests` | #46 branch | current PR head | Budget/repeat-import reliability tests and durable M5 execution handoff |

These are stacked dependencies. Preserve their order and do not merge a later PR before its base changes are integrated. User approval to merge a separate `dl-models-test` PR was not actionable: repository inspection shows the folder arrived directly on `main` via commit `5ed26d5` (`Add files via upload`), not through an identifiable PR. No PR was merged as part of that request.

## Current work in progress

- PR: [#47](https://github.com/Startat6am/3d-engine/pull/47), open and mergeable, stacked on PR #46. Branch: `feat/glb-import-stress-tests`; use the PR page for its current head SHA and check state.
- Added importer tests for triangle and embedded texture budgets, hostile declared accessor sizes rejected before geometry allocation, and 24 concurrent imports with isolated output buffers and an unchanged source GLB.
- The importer test file passes: 24/24 tests. Full workspace unit suite passes: 78/78 tests across 7 files. Full ESLint, TypeScript project build, and Prettier checks for the changed files pass. Editor and Player production Vite builds pass.
- Initial concurrency fixture exposed a fixture-construction mismatch (index accessor layout when normals are omitted); corrected the fixture to test the intended repeated-import invariant. No importer implementation change was needed.
- This is a focused reliability-test slice, not proof of bounded peak memory, GPU resource cleanup, or cancellation during synchronous parsing.

## Remaining M5 execution sequence

1. Complete GLB importer reliability tests: budget boundaries, malformed metadata, repeated/concurrent imports, source immutability, cancellation checkpoints, and failure paths.
2. Add reproducible synthetic stress fixtures/benchmarks that scale geometry and embedded textures without checking in user-private models. Record runtime, browser/Node version, device/hardware where available, input bytes, vertices/triangles, phase timings, and memory metric availability. Do not claim measured peak-memory reduction without actual measurements.
3. Audit Editor import lifecycle: repeated replacement/removal, abort/failure cleanup, decoded texture completion after entity removal, renderer disposal, and WebGL context-loss behavior. Add tests at the owning subsystem boundary.
4. Verify serialization path: source-payload hash validation, asset identity/reference semantics, save/reopen, migration fixtures, and cache lease lifetime.
5. Run full quality gates and browser acceptance; inspect Vercel Preview for the exact final commit. Record unsupported memory APIs or unavailable GPU/browser instrumentation explicitly.
6. Update `ASSETS_SERIALIZATION_STATUS.md` and `ROADMAP.md` with evidence. Only then decide whether M5 exit gate is satisfied and move to M6.

## Verification and environment notes

- Repository declares Node `>=22.12.0 <23` and pnpm `12.18.0`.
- The available sandbox previously ran Node 25 and had a broken pnpm shim; checked-in `node_modules/.bin` executables were used directly. Treat CI on the supported Node range as authoritative.
- Latest verification on this work branch: importer suite 24/24; full workspace suite 78/78 across 7 files; `tsc -b` passes; full ESLint passes; changed-file Prettier check passes; Editor and Player TypeScript + Vite production builds pass; `git diff --check` passes. A first Vite invocation from repository root failed because the app entry is relative to each app directory; rerunning each build from its correct app directory succeeded. This is a command working-directory issue, not a source failure.
- PR #46 Preview was previously `READY`: https://3d-engine-git-feat-glb-import-budget-callback5.vercel.app (commit `793c430afd28ff40f1e1712228143a94bc82f73a`). PR #47 code-bearing commit `e7ba9edcd5e623d989cab34964074bf4b97927f5` reached `READY` and its GitHub Vercel check passed; a later handoff-doc-only update was pushed, so check PR #47 for the latest Preview before browser testing.
- User's Momo import feedback: “Ускорилось все. Ок”. No numeric benchmark or memory profile was supplied.

## Product and architecture guardrails

- Keep the repository and internal packages as `Startat6am/3d-engine` and `@engine/*`; product identity is Choreon, specification language Choreonome, extension `.choreon`.
- MCP remains optional. Direct project-file workflows and MCP adapters must use the same typed contracts, validation, permissions, diff/preview, and controlled apply path.
- AI/provider SDKs must not become dependencies of core/player. Keep the approved principle: “ИИ предлагает, система проверяет, движок исполняет.”
- Do not accelerate or reorder AI authoring. Keep contracts, tests, stable errors, examples, docs, and acceptance evidence with each subsystem change.
