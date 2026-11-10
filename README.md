# Choreon

A modular, browser-first 3D engine for conventional geometry, voxels, procedural worlds, simulations and games. The editor and player are separate applications over shared engine packages.

**Project terminology**
- **Choreon** — the 3D engine and runtime.
- **Choreonome** — the planned declarative project/scene specification format.
- **`.choreon`** — the planned file extension for Choreonome documents.

The format is an architectural direction, not yet a finalized or implemented public file-format contract. Its syntax, schema, versioning and compatibility rules will be specified before files are treated as stable interchange artifacts. See [Project identity and naming](docs/PROJECT_IDENTITY.md).

## Foundation workspace

- `packages/engine-core` — renderer-independent engine lifecycle and generation-safe entity handles.
- `packages/engine-geometry` — CPU-side mesh contracts and primitive geometry.
- `packages/engine-renderer` — Three.js WebGL2 implementation behind an engine-owned adapter.
- `apps/editor` — React authoring shell with hierarchy, inspector and live 3D viewport.
- `apps/player` — minimal runtime host; no React or editor dependency.

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

| Document | Purpose |
| --- | --- |
| [Project identity](docs/PROJECT_IDENTITY.md) | Choreon, Choreonome and `.choreon` naming |
| [Engine specification](docs/ENGINE_SPEC.md) | Product scope, requirements, non-goals and acceptance |
| [Architecture](docs/ARCHITECTURE.md) | Package boundaries and dependency direction |
| [Roadmap](docs/ROADMAP.md) | Gated implementation sequence |
| [Subsystem contracts](docs/SUBSYSTEM_CONTRACTS.md) | Contract-first design, machine-readable specs, errors and tests |
| [Foundation status](docs/FOUNDATION_STATUS.md) | Implemented scaffold, verification and remaining gates |
| [API specification](docs/API_SPEC.md) | Public contracts and compatibility policy |
| [Data format](docs/DATA_FORMAT.md) | Versioned project/world serialization |
| [Rendering](docs/RENDERING_SPEC.md) | Renderer abstraction and graphics capabilities |
| [ECS](docs/ECS_SPEC.md) | Entity, component, system and transform model |
| [Asset pipeline](docs/ASSET_PIPELINE.md) | Import, identity, caching and disposal |
| [Physics](docs/PHYSICS_SPEC.md) | Physics integration contract |
| [Editor](docs/EDITOR_SPEC.md) | Authoring application |
| [Runtime](docs/RUNTIME_SPEC.md) | Player lifecycle and frame scheduling |
| [AI agent authoring](docs/AI_AGENT_SPEC.md) | Prompt-to-object/world workflow, validation and approval |
| [Testing](docs/TESTING_SPEC.md) | Quality gates and benchmark methodology |
| [ADRs](docs/ADR/) | Accepted and proposed architecture decisions |

## Status

Foundation scaffold is implemented and its CI exit gate has passed; this is not a feature-complete engine. ECS component storage/query scheduling, transform hierarchy, world serialization, asset pipeline, physics, animation, audio, input, editor commands/undo and AI authoring remain future gated milestones. The browser E2E smoke test and GitHub Actions CI pass on PR #2. Foundation remains in progress until the remaining package-boundary, renderer, lifecycle and integration acceptance gates are implemented and measured.

## Deployment

A Vercel preview deployment for PR #2 built successfully. Preview access is protected by Vercel SSO, so it is not a public demo URL. Production-domain routing and deployment access still need owner verification before publishing a public editor URL.

## License

Not decided yet. Do not assume this project is open-source licensed until a `LICENSE` file is added.

The initial Geometry & Renderer implementation adds CPU Box/Plane/Sphere/Cylinder primitives and a backend-neutral `RenderScene`/`RendererAdapter` contract with a Three.js WebGL2 implementation. See [Geometry & Renderer status](docs/GEOMETRY_RENDERER_STATUS.md).
