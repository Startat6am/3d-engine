# Roadmap

**Status:** M2–M7 complete; M6 functional scope was closed by owner direction (2026-11-19), with physical-device profiling and controlled WASM/GPU measurements explicitly deferred. M7 World & Voxels was accepted by the owner on 2026-11-22 after exact-head CI and Android smoke validation, then squash-merged via PR #90 as `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`. M8 Animation & Audio has started on `feat/m8-animation-audio`; the contract baseline and execution plan are recorded in [Animation & Audio Spec](ANIMATION_AUDIO_SPEC.md) and [M8 Execution Plan](M8_EXECUTION_PLAN.md). AI authoring remains at M10; do not reorder milestones.

| Milestone                                    | Deliverables                                                                                                                                                                                       | Exit gate                                                                                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Repository audit                          | Baseline, permissions, CI/deploy inventory                                                                                                                                                         | Empty/initial state documented; no existing work overwritten                                                                                                                                                                         |
| 1. Requirements & architecture               | Specs, ADRs, approved scope and API boundaries, AI authoring protocol                                                                                                                              | Owner approves architecture and AI safety/approval model                                                                                                                                                                             |
| 2. Foundation (complete)                     | pnpm workspace, TS project references, lint/format, Vitest, Playwright, CI, core lifecycle, initial editor/player shells                                                                           | Passed: frozen install, typecheck, lint, unit tests, E2E, minimal player/editor production builds                                                                                                                                    |
| 3. Core & ECS (complete)                     | World, entities, sparse-set components, queries, deferred commands, phased systems, events, fixed-step clock, parent validation, transform propagation, `EngineRuntime`, ECS-backed player loop    | Headless tests, phase-order tests, transform tests, player WebGL2 smoke test, and acceptance notes pass                                                                                                                              |
| 4. Geometry & renderer baseline (complete)   | CPU mesh model, camera, materials, mesh draw, WebGL2 adapter; Box/Sphere/Plane/Cylinder acceptance scene                                                                                           | CPU primitive fixtures pass; browser verifies WebGL2 draws all four primitives and produces framebuffer output                                                                                                                       |
| 5. Assets & serialization (complete)         | Versioned `.world` schema; GLB import budgets and worker lifecycle; PBR round-trip and validation; renderer resource teardown; content-addressed directory projects; browser heap/WebGL diagnostic | Passed: directory save/reopen; tampered and missing blob failures preserve the active scene; CI #306/#319/#321 green; exact-head Previews for PRs #82–#84 READY. Whole-tab RSS and physical VRAM ceilings are explicitly not claimed |
| 6. Physics & input (functional scope closed) | Rapier adapter, fixed-step simulation, raycast, input mapping                                                                                                                                      | Functional implementation and owner visual review recorded; physical-device/WASM-memory/GPU profiling remains a deferred follow-up                                                                                                   |
| 7. World & voxels (complete)                 | Chunk model, meshing, streaming, procedural hooks, editor authoring, persistence and Player integration                                                                                            | Owner accepted 2026-11-22; exact-head CI and Android smoke validation recorded in M7 execution plan and PR #90                                                                                                                       |
| 8. Animation & audio (started)               | Skeletal animation, blending, spatial audio; contract baseline and package boundaries established                                                                                                  | Animated character and audio lifecycle examples; see M8 execution plan                                                                                                                                                               |
| 9. Editor MVP                                | Hierarchy, viewport, inspector, gizmos, asset browser, undo/redo; startup bundle budget (entry JS ≤300 kB, renderer and GLB importer split into on-demand chunks)                                  | Edit-save-reopen workflow E2E; browser verification and bundle report confirm startup budget                                                                                                                                         |
| 10. AI authoring MVP                         | Provider-neutral agent protocol, mock adapter, scene context, typed plans, validation, preview, approval, atomic apply/undo                                                                        | Prompt creates a primitive and multi-object scene; approve/reject/undo/save/reopen E2E; no provider SDK in core/player                                                                                                               |
| 11. Runtime & packaging                      | Scene boot, game loop, packaging, profiling                                                                                                                                                        | Player builds and runs all acceptance scenes                                                                                                                                                                                         |
| 12. Hardening                                | Benchmarks, accessibility, docs, compatibility matrix                                                                                                                                              | Release checklist and measured baseline signed off                                                                                                                                                                                   |

## M5 closeout — 2026-11-15

- PRs #73–#80, #82, #83, and #84 are merged into `main`.
- PR #81 was superseded by PR #83 and closed.
- Directory projects use immutable SHA-256-addressed blobs and a manifest written last.
- Opening a project validates every external asset before changing the active scene.
- Missing and tampered external blobs are rejected without replacing the active scene.
- Browser memory measurements are diagnostic estimates, not tab/process RSS or physical VRAM.
- Stale blobs are retained; automatic garbage collection is not implemented.

## Sequencing constraints

Core contracts precede all feature adapters. Every subsystem must follow [Subsystem Contracts](SUBSYSTEM_CONTRACTS.md): clear interfaces, machine-readable specifications where applicable, stable actionable errors, examples, and tests are part of implementation—not deferred documentation. This is a cross-cutting engineering rule and does not reorder milestones or accelerate AI work. Geometry precedes renderer mesh ingestion. Asset identity and serialization schemas are agreed before editor save/load. Physics depends on transform synchronization. Chunk streaming depends on asset/resource lifecycle. Editor and player shell work can progress in parallel only after stable public API contracts. AI authoring depends on the component registry, serialization, editor commands/undo, and scene preview; it must not be implemented as a direct model-to-runtime mutation shortcut.

## Release policy

No milestone is marked complete based on code presence alone. Required tests, docs, acceptance scene, and known limitations must be recorded. Performance claims require reproducible benchmark output and hardware/runtime metadata.

## Model-import expansion (planned; not yet scheduled)

After the M5 asset identity, serialization, and import-lifecycle gates are stable, expand the model importer pool without changing the milestone order:

1. Keep **glTF 2.0 / GLB 2.0** as the primary interoperable model interchange target and first fully supported importer.
2. Add **.gltf JSON documents**, including external and data-URI resources, as the closest extension of the existing glTF importer.
3. Add **.blend** through an optional Blender-assisted conversion adapter (for example, a controlled background/headless Blender export to GLB), rather than implementing Blender's native project format parser in engine-core. Blender availability, version compatibility, licensing, conversion diagnostics, and preservation of source files must be explicit.
4. Evaluate **FBX** next for DCC/game-production workflows, using a maintained importer or controlled conversion path after license and deployment review.
5. Support **OBJ** as a lower-complexity static-mesh interchange format where useful; it does not replace a rigged/animated character pipeline.
6. Evaluate **USD/USDZ** for larger composed scenes and production pipelines as a separate, later capability; do not treat it as a drop-in replacement for GLB.

All source formats must normalize into the same versioned, format-neutral Choreon asset representation. Importer support is capability-based: report what was actually imported (geometry, hierarchy, materials, textures, skinning, animation), and emit actionable diagnostics for unsupported features. Format names alone must never imply complete feature support. This list is a proposed direction, not a committed delivery date or promise; each importer requires a contract, fixtures, compatibility notes, security limits, and license review. See [Asset Pipeline](ASSET_PIPELINE.md).

## M6 integration and M7 progress — 2026-11-19

- M6 was integrated into `main` by PR #87 at squash commit `54def102`. Exact-head CI run #506 passed. Physical-device profiling, controlled WASM-memory/allocation and GPU/frame-time measurements, physical gamepad checks, and cross-browser support remain explicitly deferred.
- PR #86 was closed as superseded because its planning docs were included in PR #87. Original stacked M7 PR #89 was closed and replaced with clean main-based PR #90 after the M6 squash merge. PR #88 (desktop camera controls) remains a separate change for independent review/rebase.
- M7 has a clean branch based on `main`. Phase 0 contracts/ADRs 0005–0011 are recorded. `@engine/world` provides signed chunk coordinates, canonical keys, floor-based coordinate mapping, and validated world settings with 16³ chunk dimensions.
- `@engine/voxel` provides immutable 16³ Uint16 chunk snapshots, zero-as-air / one-based palette references, stable validation errors, revisioned batch edits and changed bounds.
- Baseline CPU exposed-face meshing emits deterministic `MeshData` parts per palette material, culls intra-chunk and loaded-neighbor faces, records neighbor revisions, and marks missing-neighbor boundary output provisional.
- Local verification on the M7 branch: `pnpm check` passed with 210/210 Vitest tests and the full Playwright Chromium suite passed 23/23. The Physics Playground touch-distance assertion was widened by one fixed tick after a runner observed exactly the old 0.55 upper bound; the targeted test and full suite pass after the tolerance fix.
- Implemented since the initial M7 slice: cooperative meshing cancellation, bounded chunk streaming, deterministic generator hooks, versioned content-addressed voxel persistence, Player static collision integration and Editor coordinate-based voxel cell editing with built-in materials and revisioned palette extension. Initial mixed voxel + GLB Editor→Player acceptance passed exact-head CI #612; painted multi-material round-trip passed exact-head CI #615; viewport ray-based brush interaction, migration fixtures and voxel benchmarks remain open; palette reorder/removal is implemented.
- See [M7 Execution Plan](M7_EXECUTION_PLAN.md), [Voxel/World Spec](VOXEL_WORLD_SPEC.md), [ADR 0005–0011](ADR/), and [Project Handoff](PROJECT_HANDOFF.md).

## M7 closeout — 2026-11-22

- Owner explicitly accepted M7 after confirming Player and Editor work on the target Android device.
- Exact-head GitHub Actions run [#45022849198](https://github.com/Startat6am/3d-engine/actions/runs/45022849198) passed on `ae64a2b05a9c6fbf9e8f244e0be7850c8682438a`; local evidence included 283/283 Vitest tests and the full Chromium Playwright suite.
- PR [#90](https://github.com/Startat6am/3d-engine/pull/90) was squash-merged to `main` as `ea6a9f40ac73c6aec5ed0cdff68e15930df6ccd2`.
- Physical-device smoke validation is recorded; detailed Android GPU/memory profiling is not claimed.

## M8 kickoff — 2026-11-22

- M8 starts on `feat/m8-animation-audio`, based on the M7 merge commit.
- Normative contract: [Animation & Audio Specification](ANIMATION_AUDIO_SPEC.md). Execution and evidence log: [M8 Execution Plan](M8_EXECUTION_PLAN.md).
- ADR 0013 records CPU animation, GLB importer, renderer skinning and Web Audio package boundaries.
- First repository audit found no skinning/animation channels in the current GLB importer, no skinned renderer input, and no audio runtime package.
