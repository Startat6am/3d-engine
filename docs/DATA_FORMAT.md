# Project and World Data Format

**Status:** proposed schema baseline.

## Purpose

Define a durable project container independent of runtime implementation. glTF/GLB remains the interchange format for models and animations, not the project format.

## Container

A `.world` file is UTF-8 JSON initially (human-diffable and streamable). Binary payloads remain external assets referenced by stable asset IDs and relative URIs. A future archive container may package the same logical document without changing schema semantics.

## Top-level schema (v1)

```json
{
  "$schema": "https://example.invalid/engine/world.schema.json",
  "format": "universal-3d-world",
  "schemaVersion": "1.0.0",
  "engineVersion": "0.1.0",
  "world": {
    "id": "world:...",
    "name": "Untitled",
    "settings": { "gravity": [0, -9.81, 0], "environment": {} },
    "entities": [
      {
        "id": "entity:...",
        "name": "Camera",
        "parent": null,
        "components": {
          "Transform": { "position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] }
        }
      }
    ]
  },
  "assets": [],
  "extensions": {}
}
```

This is a normative shape sketch, not yet a published JSON Schema. Transform rotation is quaternion XYZW; units are meters, seconds, radians, and linear color unless a field says otherwise.

## Component and extension rules

Built-in components have namespaced stable type IDs and explicit schema versions. Custom components declare `typeId`, `schemaVersion`, and JSON payload. Unknown optional components are preserved losslessly in `extensions`/opaque component records; unknown required extensions cause a clear load failure. Runtime-only values (GPU handles, callbacks, caches, physics handles) are never serialized.

## Asset references

Asset records include stable ID, type, URI relative to project root, content hash, importer metadata, and optional source URI. Paths are normalized and sandboxed to project root. Hashes detect changed content; no credentials or absolute machine paths are stored.

Within one world document, asset IDs are unique. Every `MeshRenderer.assetId`, embedded `assetPayloads[].assetId`, and declared asset dependency must resolve to an asset record in the same document. Asset dependencies must be acyclic. Validation reports the offending JSON path and rejects the document before editor state is changed; unknown optional component payloads remain opaque and are not recursively interpreted as asset references.

## Migrations and compatibility

- `schemaVersion` uses semver; readers reject unsupported future major versions.
- Migrations are deterministic pure transforms: v1 -> v2, etc., each with fixtures.
- Preserve unknown optional fields where possible.
- Write atomically (temporary file then replace) and validate before commit.
- Backups are created before destructive migration; migration never silently drops unknown required data.
- Older minor documents remain readable when fields are optional/defaultable; major changes require explicit migration.

## Performance and failure handling

Parsing and validation happen off the render path. Large scenes may use streaming JSON parsing later, only if profiling demonstrates need. Errors report JSON path, entity/asset ID, and migration step.

## Tests and acceptance

Golden fixtures cover empty, hierarchy, mixed mesh/voxel, physics, custom component, missing asset, unknown extension, corrupted JSON, and every migration. Save-load-save is stable (canonical ordering and normalized numeric representation).
