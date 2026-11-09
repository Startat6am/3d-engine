# Universal 3D Engine

An extensible, browser-first 3D engine for interactive scenes, voxel and mesh worlds, simulations, and games.

> **Status:** architecture baseline approved by project owner; implementation has not started.

## Project goals

- A reusable engine, independent of any one game or content type.
- Modular TypeScript packages with explicit public contracts.
- ECS for data-oriented simulation and a transform hierarchy for spatial relationships.
- Renderer abstraction with WebGL 2 as the initial compatibility baseline and WebGPU as a separately validated backend.
- Standard asset interchange (glTF 2.0/GLB, KTX2) and a versioned `.world` project format.
- Editor and player applications built on top of the same runtime contracts.
- Prompt-driven AI authoring of objects and worlds through validated, previewable, undoable scene operations.

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
| [AI agent authoring](docs/AI_AGENT_SPEC.md) | Prompt-to-object/world workflow, operation protocol, validation and approval |
| [Testing](docs/TESTING_SPEC.md) | Quality gates and benchmark methodology |
| [ADRs](docs/ADR/) | Accepted and proposed architecture decisions |

## Current state

The repository was initially empty. The architecture baseline and AI authoring contract are documented. Implementation starts in gated milestones; documentation does not imply that runtime features are already available.

## Deployment

A Vercel project named `3d-engine` is connected to this GitHub repository. Node.js 22.x is selected and root/framework settings use automatic detection. A successful deployment currently verifies repository integration only; a functioning editor/player application requires the Foundation milestone.

## License

Not decided yet. Do not assume this project is open-source licensed until a LICENSE file is added.
