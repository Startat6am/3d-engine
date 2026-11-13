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
| 11    | [#54](https://github.com/Startat6am/3d-engine/pull/54) | `test/world-migration-chain-fixtures`      | #53 branch | `c9639110b5c3bf8ca0d3fa2cdb615b56786dbfa4` | Add legacy v0.8.0 fixture and test multi-hop/cyclic schema migrations                                      |
| 12    | [#55](https://github.com/Startat6am/3d-engine/pull/55) | `test/renderer-texture-release-e2e`        | #54 branch | `6058c62e02ad409ef29658e5634483cd64b28516` | Browser acceptance for actual WebGL texture deletion after object removal and subsequent re-import         |
| 6     | [#49](https://github.com/Startat6am/3d-engine/pull/49) | `fix/editor-glb-import-cancellation`       | #48 branch | closed                                     | Superseded by #50 after the base branch advanced                                                           |
| 7     | [#50](https://github.com/Startat6am/3d-engine/pull/50) | `fix/editor-glb-import-cancellation-v2`    | #48 branch | current PR head                            | Cancel in-flight GLB imports on editor unmount and release pending leases                                  |

These are stacked dependencies. Preserve their order and do not merge a later PR before its base changes are integrated. User approval to merge a separate `dl-models-test` PR was not actionable: repository inspection shows the folder arrived directly on `main` via commit `5ed26d5` (`Add files via upload`), not through an identifiable PR. No PR was merged as part of that request.

## Current work in progress

- PR: [#55](https://github.com/Startat6am/3d-engine/pull/55), stacked on PR #54; branch `test/renderer-texture-release-e2e`. Adds a Chromium E2E that instruments `WebGL2RenderingContext.deleteTexture`, imports a textured GLB, removes the selected entity, asserts GPU texture deletion, then imports again. Local Editor/Player builds, TypeScript, ESLint, full Vitest (83/83), Prettier, and `git diff --check` pass. CI run #127 passed all gates on Node 22.23.4, including 12/12 Chromium E2E tests. The new lifecycle test confirmed actual WebGL texture deletion after removal and successful re-import. Local Playwright could not launch because Chromium is not installed in the sandbox.
- PR: [#54](https://github.com/Startat6am/3d-engine/pull/54), stacked on PR #53; branch `test/world-migration-chain-fixtures`. Adds a legacy v0.8.0 fixture and checks two-step migration, source immutability, cycle rejection, and duplicate registration.
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
2. Synthetic geometry-only benchmark is implemented in `benchmarks/glb-import-stress.mjs`, with invocation and first measurements in `benchmarks/README.md`. Geometry-only 1,000,002-vertex run set: 180.31 ms, then 140.93/140.83 ms; 12,000,396-byte source and 28,000,056-byte geometry output. With a 16 MiB embedded image payload, source grows to 28,777,756 bytes; wall times 187.52/145.43/144.49 ms; ArrayBuffers 70.18 MiB while result retained, 27.48 MiB after result release + GC (source fixture only), then 0.03 MiB after source release. This is Node 25.9.0/Linux arm64 diagnostic data, not the supported Node 22 baseline; it samples memory rather than capturing a true peak and has no textures/GPU. Supported Node 22.23.4 baseline is now captured in `benchmarks/README.md` from CI run #120: geometry-only 246.96/207.29/215.32 ms; 16 MiB image payload 261.55/202.07/214.50 ms. ArrayBuffers returned to 0.02 MiB after source release in both cases. This is sampled memory, not peak profiling; browser image decoding/GPU allocations remain open. Do not claim measured peak-memory reduction without actual peak sampling and a comparable baseline.
3. PR #50 closes one lifecycle gap: editor unmount now aborts active GLB import controllers; pending leases are released on cancellation and cancelled work does not emit post-unmount diagnostics. PR #52 closes the stale-diagnostic part of late decode after replacement/removal/disposal. Remaining: cancellation of `createImageBitmap` itself (not supported by this adapter path), verified GPU texture disposal, renderer disposal, and WebGL context-loss behavior.
4. Serialization checks now cover source-payload SHA-256 validation, asset identity/reference semantics, save/reopen, and atomic failure on tampered payload (PR #53; Chromium CI #120). PR #54 adds a 0.8.0→0.9.0→1.0.0 fixture-backed migration chain and rejects cycles/duplicate registrations (CI #125 green). PR #55 verifies actual WebGL texture deletion after object removal and clean re-import in Chromium (CI #127, 12/12 E2E green). Still remaining: replacement while decode is in flight, shared leases across multiple live objects, and WebGL context-loss recovery.
5. Run full quality gates and browser acceptance; inspect Vercel Preview for the exact final commit. The CI workflow now listens to pull requests targeting any base branch (not only `main`), so stacked PRs receive the full Node 22 test/build/E2E pipeline. GitHub Actions run #120 is green end-to-end on Node 22.23.4, including both stress benchmarks and all 11 Chromium E2E tests. See [run #120](https://github.com/Startat6am/3d-engine/actions/runs/43171730974). Record unsupported memory APIs or unavailable GPU/browser instrumentation explicitly.
6. Update `ASSETS_SERIALIZATION_STATUS.md` and `ROADMAP.md` with evidence. Only then decide whether M5 exit gate is satisfied and move to M6.

## Verification and environment notes

- Repository declares Node `>=22.12.0 <23` and pnpm `12.18.0`.
- The available sandbox previously ran Node 25 and had a broken pnpm shim; checked-in `node_modules/.bin` executables were used directly. Treat CI on the supported Node range as authoritative.
- Latest verification on PR #47's code-bearing commit: importer suite 24/24; full workspace suite 78/78 across 7 files; `tsc -b` passes; full ESLint passes; changed-file Prettier check passes; Editor and Player TypeScript + Vite production builds pass; `git diff --check` passes. A first Vite invocation from repository root failed because the app entry is relative to each app directory; rerunning each build from its correct app directory succeeded. This is a command working-directory issue, not a source failure.
- Benchmark script was executed successfully 3 times on the synthetic 1,000,002-vertex fixture; see `benchmarks/README.md` for environment and limitations.
- PR #50 cancellation branch: `tsc -b`, full Vitest (81/81), full ESLint, full Prettier, Editor/Player production builds, and `git diff --check` pass. Vercel Preview is tracked on [PR #50](https://github.com/Startat6am/3d-engine/pull/50).
- PR #52 renderer lifecycle guard: `tsc -b`, full Vitest (81/81), full ESLint, full Prettier, Editor/Player TypeScript + production builds, and `git diff --check` pass. Vercel Preview is `READY`: https://3d-engine-orwyji2n3-callback5.vercel.app. CI trigger now includes stacked PR base branches; confirm GitHub Actions result on [PR #52](https://github.com/Startat6am/3d-engine/pull/52).
- PR #53 hash-integrity E2E: GitHub Actions run #120 passed format, lint, typecheck, unit tests (81/81), builds, both Node 22 GLB stress cases, Chromium installation, and all 11 Playwright E2E tests. Docs follow-up run #122 also passed.
- PR #54 migration fixture tests: full workspace unit suite 83/83, TypeScript project build, full ESLint, full Prettier, and `git diff --check` pass. GitHub Actions run #125 passed every step, including both GLB stress benchmarks and all 11 Chromium E2E tests. Preview for head `c9639110b5c3bf8ca0d3fa2cdb615b56786dbfa4` is READY: https://3d-engine-a0a0j6y8i-callback5.vercel.app.
- PR #46 Preview was previously `READY`: https://3d-engine-git-feat-glb-import-budget-callback5.vercel.app (commit `793c430afd28ff40f1e1712228143a94bc82f73a`). PR #47 code-bearing commit `e7ba9edcd5e623d989cab34964074bf4b97927f5` reached `READY` and its GitHub Vercel check passed; a later handoff-doc-only update was pushed, so check PR #47 for the latest Preview before browser testing.
- User's Momo import feedback: “Ускорилось все. Ок”. No numeric benchmark or memory profile was supplied.

## Product and architecture guardrails

- Keep the repository and internal packages as `Startat6am/3d-engine` and `@engine/*`; product identity is Choreon, specification language Choreonome, extension `.choreon`.
- MCP remains optional. Direct project-file workflows and MCP adapters must use the same typed contracts, validation, permissions, diff/preview, and controlled apply path.
- AI/provider SDKs must not become dependencies of core/player. Keep the approved principle: “ИИ предлагает, система проверяет, движок исполняет.”
- Do not accelerate or reorder AI authoring. Keep contracts, tests, stable errors, examples, docs, and acceptance evidence with each subsystem change.
