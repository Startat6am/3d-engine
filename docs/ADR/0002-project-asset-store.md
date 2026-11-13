# ADR-0002: Content-addressed project asset directory

- **Status:** Accepted
- **Date:** 2026-11-13

## Context

The v1 .world document is a UTF-8 JSON manifest with stable asset IDs, project-relative URIs, and content hashes. The current Editor round-trip also embeds source payloads in the optional assetPayloads array as Base64. That is convenient for a portable single-file export, but it is not the same as the project-folder model described by the data-format baseline:

- Base64 increases binary size and forces large binary values through JSON parsing/string allocation.
- Binary payload changes make the manifest diff noisy and duplicate bytes when multiple worlds reference the same asset.
- A file-oriented project should let a user or an AI coding agent inspect and edit the manifest and asset files independently in a Git repository.
- The project format must remain independent of GLB/glTF and must not turn the .choreon Choreonome specification extension into an archive/container format.

## Decision

1. **Keep .world as a UTF-8 JSON manifest.** It remains the source of truth for world entities, component data, stable asset IDs, dependencies, content hashes, and relative asset URIs.
2. **Use a directory-based project asset store for normal project work.** Binary assets are immutable, content-addressed files beneath the selected project root:

        project/
          worlds/
            main.world
          assets/
            sha256/
              ab/
                <64-hex-sha256>.glb
              12/
                <64-hex-sha256>.png

   The exact extension comes from a small allowlisted MIME-to-extension mapping; unknown binary types use .bin. The URI stored in an asset record is project-relative, for example assets/sha256/ab/<digest>.glb.

3. **Use content hashes as storage identity, not asset IDs or filenames.** The asset ID remains a stable logical reference inside the world. The file path is derived from the verified SHA-256 digest, so identical bytes can be shared by multiple asset records/worlds and existing blobs are never overwritten with different content.
4. **Keep assetPayloads as a compatibility and portability feature.** Existing v1 files with embedded Base64 payloads remain readable. A single-file .world export may include assetPayloads; a directory-project save writes external binary files and omits the embedded payload array. No schema-version bump is required because the field is already optional and asset URIs are already part of v1.
5. **Resolve and verify before mutating editor state.** Opening a directory project reads the .world manifest, validates each relative URI, loads the referenced bytes, verifies their SHA-256 content hash and MIME/type constraints, and stages the complete world before committing it. If a payload is embedded, its hash must match the asset record as well. Missing or mismatched external assets reject the open atomically.
6. **Write assets before the manifest.** Save writes any missing content-addressed blobs, verifies their hashes, then writes/replaces the .world manifest last. Each file write is committed through the browser file-system writable stream. A crash can leave unreferenced blobs, but cannot make the manifest point to a blob that has not been written. Garbage collection of unreferenced blobs is a separate explicit operation; do not delete files automatically during save.
7. **Keep filesystem access behind an adapter.** Core, serialization, importer, and Player packages do not depend on DOM or File System Access API types. The Editor owns a project-storage adapter. The browser implementation uses the File System Access API where available; environments without directory access retain the current self-contained .world import/export path.
8. **Constrain paths to the project root.** Reject absolute paths, URL schemes, backslashes, NUL bytes, empty path segments, and . / .. traversal segments. Never serialize machine-specific absolute paths, credentials, or file handles. Browser directory handles provide the root capability; the adapter must not resolve paths outside it.
9. **Do not introduce a ZIP/project archive now.** A plain directory is easier to inspect, diff, edit with Git, and operate on by coding agents. .choreon remains reserved for Choreonome documents; a project-level Choreonome manifest can be considered only after its grammar is stable.

## Consequences

- A project directory is the preferred editable and AI-agent-friendly representation; .world remains the manifest, not the binary bundle.
- Single-file .world remains portable through optional embedded Base64 payloads, preserving current workflows and backward compatibility.
- The implementation needs a small storage adapter, safe relative-path resolver, hash-verifying read/write flow, and an Editor directory-picker integration.
- The first implementation should use an in-memory adapter for deterministic tests and a browser File System Access adapter in the Editor. Unsupported browsers continue to use the single-file path.
- Orphaned content-addressed files are safe but may consume disk space; an explicit garbage-collection command can be added later.
- This ADR does not claim that browser file-system permissions persist across sessions or that every browser supports directory access.

## Acceptance tests for implementation

- Save a world with a model and embedded texture into a new project directory; verify binary files exist at deterministic content-addressed paths and the .world manifest contains relative URIs but no Base64 payload array.
- Reopen the project and verify all assets, hashes, material references, and scene contents round-trip.
- Tamper with or remove one external blob; opening must fail without replacing the current scene.
- Reject traversal, absolute paths, URL schemes, and malformed digests before any file access.
- Save the same bytes from two logical asset IDs and verify they reuse one content-addressed blob.
- Preserve existing v1 .world fixtures with embedded assetPayloads and preserve standalone import/export behavior.
- Simulate a failed manifest write after asset writes; the prior manifest remains valid and newly written unreferenced blobs are harmless.
