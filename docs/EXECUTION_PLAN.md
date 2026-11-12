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

## PR stack — merge in order; no PR merged without explicit approval

| Order |                                                     PR | Branch                                     | Base       | Known head                                 | Purpose                                                                                                    |
| ----- | -----------------------------------------------------: | ------------------------------------------ | ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1     | [#44](https://github.com/Startat6am/3d-engine/pull/44) | `feat/glb-sampler-texture-transform`       | `main`     | `01a0fdbfefc56c4297b68a747ff4097a1f372374` | GLB sampler/texture transform, compressed asset support, diagnostics, editor/render performance fixes      |
| 2     | [#45](https://github.com/Startat6am/3d-engine/pull/45) | `fix/glb-import-memory`                    | #44 branch | `42630a865b772192995f726e7713783152f75ea4` | Reduce peak memory in accessor decode, meshopt decompression, textures, and payload encoding               |
| 3     | [#46](https://github.com/Startat6am/3d-engine/pull/46) | `feat/glb-import-budget`                   | #45 branch | `793c430afd28ff40f1e1712228143a94bc82f73a` | Configurable import budgets, typed resource-limit errors, diagnostics, typed-array allocation improvements |
| 4     | [#47](https://github.com/Startat6am/3d-engine/pull/47) | `feat/glb-import-stress-tests`             | #46 branch | current PR head                            | Budget/repeat-import reliability tests and durable M5 execution handoff                                    |
| 5     | [#48](https://github.com/Startat6am/3d-engine/pull/48) | `feat/glb-import-benchmark`                | #47 branch | current PR head                            | Synthetic GLB stress runner and measured Node memory/timing baseline                                       |
| 8     | [#51](https://github.com/Startat6am/3d-engine/pull/51) | `feat/glb-import-texture-stress`           | #50 branch | current PR head                            | Add embedded image payloads to synthetic GLB stress benchmark                                              |
| 9     | [#52](https://github.com/Startat6am/3d-engine/pull/52) | `fix/renderer-ignore-stale-texture-errors` | #51 branch | current PR head                            | Suppress late texture decode errors for disposed/replaced scene resources                                  |
| 10    | [#53](https://github.com/Startat6am/3d-engine/pull/53) | `test/asset-payload-hash-atomic-open`      | #52 branch | current PR head                            | Verify tampered embedded payload hash rejection and atomic world open                                      |
| 6     | [#49](https://github.com/Startat6am/3d-engine/pull/49) | `fix/editor-glb-import-cancellation`       | #48 branch | closed                                     | Superseded by #50 after the base branch advanced                                                           |
| 7     | [#50](https://github.com/Startat6am/3d-engine/pull/50) | `fix/editor-glb-import-cancellation-v2`    | #48 branch | current PR head                            | Cancel in-flight GLB imports on editor unmount and release pending leases                                  |

These are stacked dependencies. Preserve their order and do not merge a later PR before its base changes are integrated. User approval to merge a separate `dl-models-test` PR was not actionable: repository inspection shows the folder arrived directly on `main` via commit `5ed26d5` (`Add files via upload`), not through an identifiable PR. No PR was merged as part of that request.

## Current work in progress

- PR: [#53](https://github.com/Startat6am/3d-engine/pull/53), stacked on PR #52; branch `test/asset-payload-hash-atomic-open`. Adds browser acceptance for corrupted embedded texture bytes: hash mismatch must reject the load without mutating the currently open scene/assets.
- PR: [#52](https://github.com/Startat6am/3d-engine/pull/52), stacked on PR #51; branch `fix/renderer-ignore-stale-texture-errors`. Late texture decode failures are now ignored after renderer disposal, object removal, or source replacement; current failures still emit diagnostics.
- PR: [#51](https://github.com/Startat6am/3d-engine/pull/51), stacked on PR #50; branch `feat/glb-import-texture-stress`. It adds a 16 MiB embedded-image stress case to the synthetic GLB benchmark.
- PR: [#50](https://github.com/Startat6am/3d-engine/pull/50), stacked on PR #48; branch `fix/editor-glb-import-cancellation-v2`. It carries the editor-lifetime cancellation fix on the current base branch. PR #49 was closed as superseded after its base advanced and GitHub reported a merge conflict.
- PR: [#48](https://github.com/Startat6am/3d-engine/pull/48), stacked on PR #47; branch `feat/glb-import-benchmark`. This adds a generated geometry-only stress benchmark and records a first local baseline.
- PR: [#47](https://github.com/Startat6am/3d-engine/pull/47), open and mergeable, stacked on PR #46. Branch: `feat/glb-import-stress-tests`; use the PR page for its current head SHA and check state.
- Added importer tests for triangle and embedded texture budgets, hostile declared accessor sizes rejected before geometry allocation, and 24 concurrent imports with isolated output buffers and an unchanged source GLB.
- PR #47 baseline: importer 24/24; workspace 78/78. PR #50 adds three AssetImportScope tests; full workspace now passes 81/81 across 7 files. TypeScript project build, full ESLint, full Prettier, and Editor/Player production builds pass.
- Initial concurrency fixture exposed a fixture-construction mismatch (index accessor layout when normals are omitted); corrected the fixture to test the intended repeated-import invariant. No importer implementation change was needed.
- This is a focused reliability-test slice, not proof of bounded peak memory, GPU resource cleanup, or cancellation during synchronous parsing.

## Remaining M5 execution sequence

1. Importer budget/repeat-import slice is covered by PR #47: budget rejection, hostile accessor preflight, concurrent repeated imports, and source immutability. More malformed-metadata and failure-path cases remain.
2. Synthetic geometry-only benchmark is implemented in `benchmarks/glb-import-stress.mjs`, with invocation and first measurements in `benchmarks/README.md`. Geometry-only 1,000,002-vertex run set: 180.31 ms, then 140.93/140.83 ms; 12,000,396-byte source and 28,000,056-byte geometry output. With a 16 MiB embedded image payload, source grows to 28,777,756 bytes; wall times 187.52/145.43/144.49 ms; ArrayBuffers 70.18 MiB while result retained, 27.48 MiB after result release + GC (source fixture only), then 0.03 MiB after source release. This is Node 25.9.0/Linux arm64 diagnostic data, not the supported Node 22 baseline; it samples memory rather than capturing a true peak and has no textures/GPU. The CI workflow now runs both cases on supported Node 22 after the workspace build; record those logs before treating the runtime baseline as accepted. Browser/image-decode profiling remains open. Do not claim measured peak-memory reduction without actual peak sampling and a comparable baseline.
3. PR #50 closes one lifecycle gap: editor unmount now aborts active GLB import controllers; pending leases are released on cancellation and cancelled work does not emit post-unmount diagnostics. PR #52 closes the stale-diagnostic part of late decode after replacement/removal/disposal. Remaining: cancellation of `createImageBitmap` itself (not supported by this adapter path), verified GPU texture disposal, renderer disposal, and WebGL context-loss behavior.
4. Serialization checks now cover source-payload SHA-256 validation, asset identity/reference semantics, save/reopen, and a new tamper test that verifies failed open is atomic (PR #53). Remaining: execute this browser test in CI/Chromium, add migration round-trip fixtures beyond the current 0.9.0→1.0.0 unit case, and verify cache lease lifetime under real browser replacement/removal.
5. Run full quality gates and browser acceptance; inspect Vercel Preview for the exact final commit. The CI workflow now listens to pull requests targeting any base branch (not only `main`), so stacked PRs receive the full Node 22 test/build/E2E pipeline. The workflow-run query only returns PR-triggered runs; confirm the Actions checks on GitHub before treating the Node 22 stress baseline as accepted. Record unsupported memory APIs or unavailable GPU/browser instrumentation explicitly.
6. Update `ASSETS_SERIALIZATION_STATUS.md` and `ROADMAP.md` with evidence. Only then decide whether M5 exit gate is satisfied and move to M6.

## Verification and environment notes

- Repository declares Node `>=22.12.0 <23` and pnpm `12.18.0`.
- The available sandbox previously ran Node 25 and had a broken pnpm shim; checked-in `node_modules/.bin` executables were used directly. Treat CI on the supported Node range as authoritative.
- Latest verification on PR #47's code-bearing commit: importer suite 24/24; full workspace suite 78/78 across 7 files; `tsc -b` passes; full ESLint passes; changed-file Prettier check passes; Editor and Player TypeScript + Vite production builds pass; `git diff --check` passes. A first Vite invocation from repository root failed because the app entry is relative to each app directory; rerunning each build from its correct app directory succeeded. This is a command working-directory issue, not a source failure.
- Benchmark script was executed successfully 3 times on the synthetic 1,000,002-vertex fixture; see `benchmarks/README.md` for environment and limitations.
- PR #50 cancellation branch: `tsc -b`, full Vitest (81/81), full ESLint, full Prettier, Editor/Player production builds, and `git diff --check` pass. Vercel Preview is tracked on [PR #50](https://github.com/Startat6am/3d-engine/pull/50).
- PR #52 renderer lifecycle guard: `tsc -b`, full Vitest (81/81), full ESLint, full Prettier, Editor/Player TypeScript + production builds, and `git diff --check` pass. Vercel Preview is `READY`: https://3d-engine-orwyji2n3-callback5.vercel.app. CI trigger now includes stacked PR base branches; confirm GitHub Actions result on [PR #52](https://github.com/Startat6am/3d-engine/pull/52).
- PR #53 hash-integrity E2E: formatting, lint, TypeScript, and full unit suite pass; targeted Playwright cannot launch locally because Chromium is absent. The new unfiltered pull-request CI trigger is expected to run this on CI; do not count browser acceptance as passed until that run is green.
- PR #46 Preview was previously `READY`: https://3d-engine-git-feat-glb-import-budget-callback5.vercel.app (commit `793c430afd28ff40f1e1712228143a94bc82f73a`). PR #47 code-bearing commit `e7ba9edcd5e623d989cab34964074bf4b97927f5` reached `READY` and its GitHub Vercel check passed; a later handoff-doc-only update was pushed, so check PR #47 for the latest Preview before browser testing.
- User's Momo import feedback: “Ускорилось все. Ок”. No numeric benchmark or memory profile was supplied.

## Product and architecture guardrails

- Keep the repository and internal packages as `Startat6am/3d-engine` and `@engine/*`; product identity is Choreon, specification language Choreonome, extension `.choreon`.
- MCP remains optional. Direct project-file workflows and MCP adapters must use the same typed contracts, validation, permissions, diff/preview, and controlled apply path.
- AI/provider SDKs must not become dependencies of core/player. Keep the approved principle: “ИИ предлагает, система проверяет, движок исполняет.”
- Do not accelerate or reorder AI authoring. Keep contracts, tests, stable errors, examples, docs, and acceptance evidence with each subsystem change.
