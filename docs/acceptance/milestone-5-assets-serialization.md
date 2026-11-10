# Milestone 5 — Assets & serialization (initial integration)

## Scope delivered in this slice

- Editor GLB imports now pass through the format-neutral `AssetImportService` and register a project-scoped `AssetRecord`.
- Each imported file records a normalized project-relative URI, SHA-256 content hash, importer ID/version/settings, source file size, and importer metadata.
- Imported mesh entities carry the stable asset ID. World serialization writes the asset registry, entity references, and original GLB bytes as base64 payloads; loading verifies each payload SHA-256 against its asset record before applying the scene.
- Registry restoration merges records into the current editor session so undo history does not lose previously known asset identities.
- Add a generic `AssetResourceCache` with concurrent-load deduplication, synchronous and asynchronous acquisition, reference-counted leases, idempotent release, disposal after the final lease, and retry after failed loads. The Editor caches decoded GLB data by content hash and releases leases when the editor session unmounts.
- The WebGL2 renderer uses the same cache contract for `BufferGeometry` and `MeshStandardMaterial` resources. Meshes hold individual leases; replacing or removing a mesh releases its leases, and GPU-side objects are disposed only after their final renderer consumer releases them. Geometry/material sharing is deduplicated within a renderer instance. Orthographic camera state is reused rather than allocating a camera on every render.

## Verification

- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 52 unit tests passed across 7 files, including synchronous cache sharing, final-lease disposal, and protection against mixing in-flight async and sync loads.
- `pnpm --filter @engine/editor build` — passed; initial editor JS remains below the 300 KB roadmap budget.
- `pnpm --filter @engine/player build` — passed.
- `pnpm e2e` — 9 browser tests passed, including GLB import, source payload/hash verification, world save/reopen, asset ID persistence, and WebGL2 primitive rendering.

## Remaining milestone gates

- Extend renderer-managed caching to decoded textures, textures/material dependencies, and cross-session/project asset identities; the current GPU cache covers geometry and standard materials within one renderer instance.
- Move embedded base64 GLB payloads into a binary project asset store and support external dependencies without inflating the world JSON document.
- Add explicit asset replacement/reimport and dependency invalidation workflows.
- Complete resource disposal and memory acceptance checks before marking Milestone 5 complete.
