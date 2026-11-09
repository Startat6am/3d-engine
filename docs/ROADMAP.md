# Roadmap

**Status:** proposed gated plan. Architecture baseline and AI authoring direction approved; implementation gates remain mandatory.

| Milestone | Deliverables | Exit gate |
| --- | --- | --- |
| 0. Repository audit | Baseline, permissions, CI/deploy inventory | Empty/initial state documented; no existing work overwritten |
| 1. Requirements & architecture | Specs, ADRs, approved scope and API boundaries, AI authoring protocol | Owner approves architecture and AI safety/approval model |
| 2. Foundation | pnpm workspace, TS project references, lint/format, Vitest, Playwright, CI, core lifecycle | Clean install, typecheck, lint, unit tests, minimal player/editor shell build |
| 3. Core & ECS | World, entities, component storage, systems, transform hierarchy, events, clock | Headless ECS/transform tests and API contract tests |
| 4. Geometry & renderer baseline | CPU mesh model, camera, materials, mesh draw, WebGL2 adapter | Primitive scene and renderer conformance tests |
| 5. Assets & serialization | Registry, glTF/GLB, textures, versioned .world, migrations | Import and round-trip/migration fixtures |
| 6. Physics & input | Rapier adapter, fixed-step simulation, raycast, input mapping | Physics playground and deterministic adapter tests within stated limits |
| 7. World & voxels | Chunk model, meshing, streaming, procedural hooks | Voxel and mixed-scene acceptance; memory/disposal checks |
| 8. Animation & audio | Skeletal animation, blending, spatial audio | Animated character and audio lifecycle examples |
| 9. Editor MVP | Hierarchy, viewport, inspector, gizmos, asset browser, undo/redo | Edit-save-reopen workflow E2E |
| 10. AI authoring MVP | Provider-neutral agent protocol, mock adapter, scene context, typed plans, validation, preview, approval, atomic apply/undo | Prompt creates a primitive and multi-object scene; approve/reject/undo/save/reopen E2E; no provider SDK in core/player |
| 11. Runtime & packaging | Scene boot, game loop, packaging, profiling | Player builds and runs all acceptance scenes |
| 12. Hardening | Benchmarks, accessibility, docs, compatibility matrix | Release checklist and measured baseline signed off |

## Sequencing constraints
Core contracts precede all feature adapters. Geometry precedes renderer mesh ingestion. Asset identity and serialization schemas are agreed before editor save/load. Physics depends on transform synchronization. Chunk streaming depends on asset/resource lifecycle. Editor and player shell work can progress in parallel only after stable public API contracts. AI authoring depends on the component registry, serialization, editor commands/undo, and scene preview; it must not be implemented as a direct model-to-runtime mutation shortcut.

## Release policy
No milestone is marked complete based on code presence alone. Required tests, docs, acceptance scene, and known limitations must be recorded. Performance claims require reproducible benchmark output and hardware/runtime metadata.
