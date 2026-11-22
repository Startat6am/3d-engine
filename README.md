# Choreon

A modular, browser-first 3D engine for conventional geometry, voxels, procedural worlds, simulations and games. The editor and player are separate applications over shared engine packages.

**Project terminology**

- **Choreon** — the 3D engine and runtime.
- **Choreonome** — the planned declarative project/scene specification format.
- **`.choreon`** — the planned file extension for Choreonome documents.

The format is an architectural direction, not yet a finalized or implemented public file-format contract. Its syntax, schema, versioning and compatibility rules will be specified before files are treated as stable interchange artifacts. See [Project identity and naming](docs/PROJECT_IDENTITY.md).

## Foundation workspace

- `packages/engine-core` — renderer-independent engine lifecycle and generation-safe entity handles.
- `packages/engine-animation` — CPU animation sampling, pose blending and playback contracts (M8 in progress).
- `packages/engine-audio` — backend-neutral audio source/listener lifecycle and spatial attenuation contracts (M8 in progress).
- `packages/engine-geometry` — CPU-side mesh contracts and primitive geometry.
- `packages/engine-renderer` — Three.js WebGL2 implementation behind an engine-owned adapter.
- `apps/editor` — React authoring shell with hierarchy, inspector and live 3D viewport.
- `apps/player` — minimal runtime host and Physics Playground sample; no React or editor dependency.

## Requirements and commands

Node.js 22.12+ and pnpm 12.18.0.

```sh
pnpm install --frozen-lockfile
pnpm --filter @engine/editor dev
pnpm --filter @engine/player dev
pnpm check
pnpm e2e
```

## Documentation

Start with [Engine specification](docs/ENGINE_SPEC.md), [Architecture](docs/ARCHITECTURE.md), and [Roadmap](docs/ROADMAP.md).

| Document                                             | Purpose                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| [Project identity](docs/PROJECT_IDENTITY.md)         | Choreon, Choreonome and `.choreon` naming                       |
| [Engine specification](docs/ENGINE_SPEC.md)          | Product scope, requirements, non-goals and acceptance           |
| [Architecture](docs/ARCHITECTURE.md)                 | Package boundaries and dependency direction                     |
| [Roadmap](docs/ROADMAP.md)                           | Gated implementation sequence                                   |
| [Project handoff](docs/PROJECT_HANDOFF.md)           | Recovery point and exact next steps after chat/context loss     |
| [Subsystem contracts](docs/SUBSYSTEM_CONTRACTS.md)   | Contract-first design, machine-readable specs, errors and tests |
| [Foundation status](docs/FOUNDATION_STATUS.md)       | Implemented scaffold, verification and remaining gates          |
| [API specification](docs/API_SPEC.md)                | Public contracts and compatibility policy                       |
| [Data format](docs/DATA_FORMAT.md)                   | Versioned project/world serialization                           |
| [Rendering](docs/RENDERING_SPEC.md)                  | Renderer abstraction and graphics capabilities                  |
| [ECS](docs/ECS_SPEC.md)                              | Entity, component, system and transform model                   |
| [Asset pipeline](docs/ASSET_PIPELINE.md)             | Import, identity, caching and disposal                          |
| [Physics](docs/PHYSICS_SPEC.md)                      | Physics integration contract                                    |
| [Input](docs/INPUT_SPEC.md)                          | Device-independent input mapping and fixed-tick snapshots       |
| [M6 acceptance](docs/acceptance/M6_PHYSICS_INPUT.md) | Physics, input, editor UX and CI exit gates                     |
| [M7 execution plan](docs/M7_EXECUTION_PLAN.md)       | World and voxel milestone sequencing and acceptance             |
| [World/voxel spec](docs/VOXEL_WORLD_SPEC.md)         | Chunk, voxel, meshing, streaming and generation contracts       |
| [Editor](docs/EDITOR_SPEC.md)                        | Authoring application                                           |
| [Runtime](docs/RUNTIME_SPEC.md)                      | Player lifecycle and frame scheduling                           |
| [AI agent authoring](docs/AI_AGENT_SPEC.md)          | Prompt-to-object/world workflow, validation and approval        |
| [Testing](docs/TESTING_SPEC.md)                      | Quality gates and benchmark methodology                         |
| [ADRs](docs/ADR/)                                    | Accepted and proposed architecture decisions                    |

## Status

M2–M7 are complete. M7 World & Voxels was accepted by the owner and merged to `main` on 2026-11-22. M8 Animation & Audio is active on `feat/m8-animation-audio`; see the M8 execution plan and animation/audio specification. M6 physical-device profiling and controlled WASM/GPU measurements remain explicitly deferred. The Editor is still an incremental authoring shell, not the full Editor MVP. AI authoring remains at M10 and is not being accelerated.

## Deployment

A Vercel preview deployment for PR #2 built successfully. Preview access is protected by Vercel SSO, so it is not a public demo URL. Production-domain routing and deployment access still need owner verification before publishing a public editor URL.

## License

Not decided yet. Do not assume this project is open-source licensed until a `LICENSE` file is added.

The initial Geometry & Renderer implementation adds CPU Box/Plane/Sphere/Cylinder primitives and a backend-neutral `RenderScene`/`RendererAdapter` contract with a Three.js WebGL2 implementation. See [Geometry & Renderer status](docs/GEOMETRY_RENDERER_STATUS.md).
