# Universal 3D Engine

An extensible, browser-first 3D engine for interactive scenes, voxel and mesh worlds, simulations, and games.

> **Status:** architecture and requirements phase. No runtime capabilities are claimed yet.

## Project goals

- A reusable engine, independent of any one game or content type.
- Modular TypeScript packages with explicit public contracts.
- ECS for data-oriented simulation and a transform hierarchy for spatial relationships.
- Renderer abstraction with WebGL 2 as the initial compatibility baseline and WebGPU as a separately validated backend.
- Standard asset interchange (glTF 2.0/GLB, KTX2) and a versioned `.world` project format.
- Editor and player applications built on top of the same runtime contracts.

## Documentation

Start with [ENGINE_SPEC.md](docs/ENGINE_SPEC.md), then read [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [ROADMAP.md](docs/ROADMAP.md).

| Document | Purpose |
| --- | --- |
| [Engine specification](docs/ENGINE_SPEC.md) | Product scope, requirements, non-goals, acceptance |
| [Architecture](docs/ARCHITECTURE.md) | Package boundaries and dependency direction |
| [Roadmap](docs/ROADMAP.md) | Gated implementation sequence |
| [API specification](docs/API_SPEC.md) | Public contracts and compatibility policy |
| [Data format](docs/DATA_FORMAT.md) | Versioned project/world serialization |
| [Rendering](docs/RENDERING_SPEC.md) | Renderer abstraction and graphics capabilities |
| [ECS](docs/ECS_SPEC.md) | Entity, component, system, and transform model |
| [Asset pipeline](docs/ASSET_PIPELINE.md) | Import, identity, caching, and disposal |
| [Physics](docs/PHYSICS_SPEC.md) | Physics integration contract |
| [Editor](docs/EDITOR_SPEC.md) | Authoring application |
| [Runtime](docs/RUNTIME_SPEC.md) | Player lifecycle and frame scheduling |
| [Testing](docs/TESTING_SPEC.md) | Quality gates and benchmark methodology |
| [ADRs](docs/ADR/) | Accepted and proposed architecture decisions |

## Current state

The repository was initially empty. The first iteration establishes architecture specifications and deployment wiring. Implementation starts only after the architecture baseline is reviewed and accepted.

## Deployment

The Vercel project is connected to this GitHub repository and is configured for a Vite app rooted at `apps/editor`. A deployable application does not exist yet; the first deployment becomes possible after the Foundation milestone adds that app, the workspace manifest, and its lockfile.

## License

Not decided yet. Do not assume this project is open-source licensed until a LICENSE file is added.
