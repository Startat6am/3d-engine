# World and Voxel Subsystem Specification

**Status:** M7 implementation in progress; coordinate/settings, immutable chunk storage/palette validation, deterministic CPU meshing, stale-result validation, cooperative AbortSignal cancellation, bounded chunk scheduling, deterministic seeded generation, content-addressed persistence, Player static collision integration and Editor coordinate-based voxel cell editing and empty-chunk creation with a shared built-in material library are implemented. The initial mixed voxel+GLB Editor→Player round-trip passed exact-head Chromium CI #612. Painted multi-material Editor→Player round-trip passed exact-head Chromium CI #615. Viewport ray-based brush interaction and hover preview are implemented. A cross-package scheduler/voxel integration test now covers load, edit, async mesh, explicit eviction, release and disposal. Custom voxel material assets with editable color/roughness and optional texture dependencies flow through the Editor asset registry, project payload store and Player renderer. Optional PNG/JPEG/WebP base-color texture authoring/sampling and custom roughness controls are implemented. Migration fixtures, browser-level streaming lifecycle acceptance and broader device validation remain open.
**Milestone:** 7 — World & Voxels.

## Purpose and boundaries

Provide a format-neutral world layer for spatially partitioned content and a voxel representation that coexists with conventional mesh entities. World/chunk orchestration owns chunk identity, coordinates, residency, streaming state, bounded job scheduling, and procedural-generation hooks. Voxel data owns the discrete cell representation and conversion to renderable/collision-ready geometry.

The voxel subsystem is a geometry provider. It must not introduce voxel-specific branches into ECS identity, generic Transform, renderer contracts, the project serialization envelope, or gameplay-facing entity APIs.

## Package boundaries

- world package: chunk coordinates, lifecycle, residency, streaming orchestration, bounded asynchronous jobs, and generator interfaces.
- voxel package: palette/material references, the shared built-in material catalog, cell buffers, validation, and CPU mesh generation.
- geometry package: shared CPU MeshData contract. Voxel meshing emits validated geometry and has no Three.js/WebGL dependency.
- renderer: consumes ordinary geometry/material descriptors and remains unaware of voxel storage.
- physics: consumes explicit collider descriptors; it does not inspect voxel buffers or own generation.
- serialization: owns versioned envelopes/migrations. Runtime handles, jobs, caches, and GPU resources are never persisted.
- Editor owns UI and browser storage permissions; Player composes runtime services without Editor dependencies.

## Current implementation snapshot

- `@engine/world`: signed safe-integer chunk coordinates, canonical keys, floor-based world-to-chunk mapping, finite positive voxel-size validation, and fixed 16³ schema-v1 chunk dimensions. A newly created Editor chunk is empty air (not a prefilled grass slab); users construct terrain by painting cells and placing adjacent chunks. World voxel edge length is editable independently of the fixed cell dimensions.
- `@engine/voxel`: immutable snapshots backed by owned Uint16 cell buffers (4,096 cells); zero is air and non-zero values are one-based palette indexes. Palette references are stable asset IDs or built-in material keys. Batch edits increment one revision and report inclusive changed bounds.
- CPU meshing: deterministic exposed-face culling, one `MeshData` part per palette index, outward normals/consistent winding, UVs, voxel-size scaling, intra-chunk and six-neighbor culling, neighbor revision tokens, and provisional boundary faces when a neighbor is unavailable.
- Meshing cancellation: `meshVoxelChunkAsync` cooperatively yields between z-slices, observes `AbortSignal`, and rejects with `MESHING_ABORTED` before returning any result; partial geometry remains private.
- World streaming: `WorldChunkScheduler<T>` bounds concurrency, queue depth, resident count and per-chunk payload bytes; it deduplicates coordinate/revision requests, orders by priority, propagates cancellation, rejects stale completions, and exposes explicit eviction/disposal.
- Procedural hook: `createChunkGenerationContext` combines a validated seed, signed chunk coordinate, AbortSignal and deterministic coordinate-scoped PRNG.
- Implemented: repeated scheduler load/evict/dispose stress coverage, versioned content-addressed chunk blobs, Player static collider lifecycle integration, Editor coordinate-based voxel cell painting/erasing, viewport ray-based brush interaction with hover preview, and a visual shared material library feeding each chunk's local palette. The Editor can create named custom solid-color voxel materials as content-hashed project assets; the Player resolves their color/roughness metadata when loading the project. Remaining: custom texture assignment/sampling, browser-level streaming lifecycle acceptance and migration fixtures.

## Editor authoring model

- Creating a voxel chunk creates an **empty 16 × 16 × 16 storage region**. It does not create a solid cube or a terrain surface. Air is represented by cell value 0; an untouched chunk therefore has no render mesh.
- Chunk dimensions remain fixed at 16³ for persisted schema v1. This is an intentional bounded storage/meshing unit, not a limit on the size of a world or the amount of terrain a user can build. Adjacent signed-coordinate chunks compose larger continuous spaces. Changing chunk dimensions requires a new payload codec/schema migration; do not reinterpret existing v1 buffers.
- voxelSize is an independent world setting that controls the world-space edge length of each cell. The Editor exposes it on the selected chunk inspector because it affects the whole voxel world, not just one chunk.
- Built-in voxel materials live in a shared engine catalog with stable keys, display labels, preview colors and roughness. The selected-chunk inspector displays this catalog as a world material swatch library. Selecting a swatch changes the active paint material; it does not immediately modify any chunk.
- The Hierarchy add menu exposes the action as “Voxel chunk” (accessible name “Add Voxel chunk”); the supporting label clarifies that it creates an empty 16³ editable grid. Keep the stable action name so Editor E2E and assistive technology can locate it independently of descriptive copy.
- A new chunk starts with an empty local palette. When a cell is first painted with a material, that chunk appends one reference to its local palette. Cells store compact one-based indexes into that local palette (0 remains air). Repainting with the same material reuses its existing local index. Thus the world library is shared, while each chunk stores only references to materials actually used in that chunk; palette ordering can be changed without changing material identity.
- The current built-in catalog is Grass, Dirt, Stone, Sand, Wood, Snow and Water. Users can also create named custom materials with editable 24-bit base color and roughness (0–1), optionally assigning a PNG/JPEG/WebP base-color texture up to 16 MiB. Each material is a content-addressed `material` asset with a schema-v1 JSON payload and a stable asset ID. A texture is a separate content-addressed `texture` asset, referenced from the material metadata and dependency list. Chunk palettes reference only the material asset ID. Editor and Player resolve the same asset records; Player passes decoded bytes through the renderer `TextureSource` contract. Missing or unsupported texture dependencies fall back to the material base color. The swatches remain color previews, not texture thumbnails or an atlas; a project-wide material browser and additional PBR channels remain follow-up work.
- A logical voxel object larger than one chunk is represented by a set of chunks in world coordinates. A dedicated hierarchy/grouping and transform wrapper for voxel assemblies is not part of the current Editor slice.

## Coordinate and identity model

Record the coordinate convention in an ADR before implementation:

- World units are meters; voxel edge length is an explicit world setting.
- Chunk coordinates are signed integer triples; cell coordinates are integer triples local to a chunk.
- World-to-chunk conversion uses floor-based partitioning, including negative coordinates, never truncation toward zero.
- Chunk dimensions are fixed for one persisted schema/version unless a migration explicitly changes them.
- Chunk identity derives from world identity plus integer chunk coordinate; it is not an ECS EntityId or filesystem path.
- Every cell belongs to exactly one chunk, including exact boundaries.

The ADR must choose chunk dimensions, voxel-size defaults, numeric representation, and overflow limits using tests and benchmark workloads.

## Voxel data contract

- A chunk payload identifies schema version, dimensions, world-settings reference, and palette/material table.
- Cell values refer to palette entries through a documented integer encoding. Empty space has a reserved value that cannot alias a material.
- Palette entries use stable project asset/material references or supported built-in descriptors; no arbitrary URLs or absolute paths.
- Reject invalid palette indices, unsupported dimensions, truncated buffers, and over-budget values before meshing or allocation.
- Dense, sparse, or hybrid storage is an implementation decision to benchmark. Private typed-array layout is not a public compatibility promise.
- Edits report changed regions and revisions so dependent mesh/collision products can be invalidated.

## Meshing contract

The initial mesher produces deterministic, bounded CPU geometry for an immutable chunk snapshot plus neighbor-border snapshots:

- Omit internal faces between adjacent solid cells.
- Define a neighbor-availability policy so missing neighbors do not cause permanent holes or duplicate surfaces after streaming.
- Preserve material boundaries in output submeshes/material groups.
- Match geometry positions, normals, indices, winding, and scale to the shared geometry contract.
- Empty chunks produce no mesh allocation beyond a lightweight empty result.
- Revision-tag asynchronous results; discard stale results rather than replacing newer edits.
- Support explicit cancellation and resource budgets.

Greedy meshing, ambient occlusion, lighting bake, LOD, and GPU meshing are not assumed in the first slice. Choose the simplest mesher that passes fixtures; optimize only with measured evidence.

## Streaming and lifecycle

Streaming is a bounded state machine, not an unbounded promise queue. Define transitions for requested, loading/generating, meshing, resident, evicting, failed, and disposed (or an approved equivalent).

Requirements:

- Bound concurrent jobs, queued work, resident chunks, and retained CPU geometry.
- Support priority/cancellation and release intermediate buffers on cancellation.
- Deduplicate requests for the same world/chunk/revision.
- Ignore stale completions after edits, world replacement, or disposal.
- Make eviction explicit and idempotent; release voxel data, generated meshes, collision resources, and owned job references.
- Return stable error codes with world/chunk/revision/stage context.
- World shutdown cancels outstanding work and releases owned jobs/resources.
- Worker and main-thread implementations conform to the same contract. Workers are not required for correctness.

## Procedural generation

Generators are registered typed capabilities, not arbitrary scripts. A generator receives immutable world settings, seed, chunk coordinate, declared inputs, and cancellation signal. It returns a validated chunk payload plus structured diagnostics. Persist seed and generator version. Bound generation by cell, palette, time, and memory budgets. Convert exceptions and malformed output into stable engine errors.

The first slice may ship a deterministic test generator and a small example; it does not require a node graph or AI generation.

## Serialization and compatibility

Persist voxel/world content through the existing versioned world envelope. Do not serialize runtime residency, pending jobs, caches, renderer handles, physics handles, or device state.

Provide a versioned machine-readable chunk schema, semantic validation for palette/material references and duplicate chunk identities, deterministic canonical serialization where practical, migration fixtures, and atomic open semantics. Choose inline payloads versus content-addressed blobs in an ADR. Large payloads must not be Base64-expanded by default in directory projects; follow the existing project asset-store contract.

## Physics and mixed-scene integration

Voxel content may provide static collision geometry through the existing physics contract. Collision generation is explicit, bounded, revision-aware, and disposed with the owning chunk. M7 does not add dynamic/kinematic triangle meshes or implicit cooking.

A mixed world supports voxel chunks alongside conventional mesh entities, lights/cameras, and existing physics bodies without changing their public APIs.

## Errors and diagnostics

Define stable categories for invalid coordinates/dimensions, malformed payload, palette/material resolution failure, generation/meshing failure, stale result, queue/resource budget exceeded, cancellation, serialization/migration failure, and disposed world/chunk. Include stage, world/chunk identity, revision, and offending field/cell where available. Do not log full project payloads or secrets.

## Verification and acceptance

Required tests cover negative/exact chunk boundaries and overflow; empty/full/checkerboard/material-boundary fixtures; adjacent chunks and neighbor arrival/removal order; face culling/winding/normals/indices/scale; edit-during-mesh and stale-result rejection; cancellation/deduplication/limits/eviction/disposal; deterministic generators and malformed/over-budget output; serialization/migrations/atomic open failure; mixed voxel + mesh worlds; and repeated load/edit/evict cycles.

Acceptance evidence records exact commit, Node/browser versions, test counts, chunk dimensions/voxel counts, job limits, memory measurements, and benchmark workload. Shared CI/headless results are diagnostic; do not claim physical-device memory or GPU limits without device metadata.

## Decisions required before implementation

Create ADRs for package split and dependency graph; coordinate convention/chunk dimensions/voxel scale/integer limits; storage layout/palette identity; meshing baseline/border policy; streaming state machine/job limits/eviction/worker boundary; persisted chunk representation/asset-store integration; and static collision generation/resource ownership.

Each decision must cite tests/benchmarks or explain the conservative baseline. Do not implement the full feature before these contracts and decisions are reviewed.

## Custom voxel material asset contract

- A custom material is an `AssetRecord` with `kind: material`, `metadata.role: voxel-material`, validated `color` (24-bit RGB) and `roughness` (0–1). Its JSON source payload uses schema version 1 and stores the same authored values.
- An optional base-color texture is a separate `AssetRecord` with `kind: texture`, `metadata.role: voxel-texture`, and PNG/JPEG/WebP MIME type. The material references it through `metadata.baseColorTextureAssetId` and the material record dependency list.
- The Editor accepts non-empty texture files up to 16 MiB. Project storage persists the material and texture as content-addressed assets; chunk palettes store only the material asset ID.
- Player resolves the material and texture payload to the backend-neutral `TextureSource` contract. Renderer owns decode/GPU caching; voxel storage remains independent of Three.js and texture runtime objects. If the texture dependency or payload cannot be resolved, the authored solid color remains the fallback.
