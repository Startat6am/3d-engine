# Milestone 5 — Assets & serialization (initial integration)

## Scope delivered in this slice

- Editor GLB imports now pass through the format-neutral `AssetImportService` and register a project-scoped `AssetRecord`.
- Each imported file records a normalized project-relative URI, SHA-256 content hash, importer ID/version/settings, source file size, and importer metadata.
- Imported mesh entities carry the stable asset ID. World serialization writes the asset registry and entity references; world loading validates and restores records before applying the scene.
- Registry restoration merges records into the current editor session so undo history does not lose previously known asset identities.
- Add a generic `AssetResourceCache` with concurrent-load deduplication, reference-counted leases, idempotent release, disposal after the final lease, and retry after failed loads.

## Verification

- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 49 unit tests passed across 7 files.
- `pnpm --filter @engine/editor build` — passed; initial editor JS remains below the 300 KB roadmap budget.
- `pnpm --filter @engine/player build` — passed.
- `pnpm e2e` — 9 browser tests passed, including GLB import, world save/reopen, asset ID/content hash persistence, and WebGL2 primitive rendering.

## Remaining milestone gates

- Connect the generic resource cache to decoded mesh/texture and GPU resource lifetimes; currently the cache contract is tested independently.
- Persist/reload source asset payloads and external dependencies as project files, rather than relying on embedded mesh buffers in the world document.
- Add explicit asset replacement/reimport and dependency invalidation workflows.
- Complete resource disposal and memory acceptance checks before marking Milestone 5 complete.
