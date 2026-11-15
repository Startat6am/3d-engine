# Editor Specification

**Status:** proposed baseline.

## Responsibility

Provide authoring UX over public engine APIs. React is confined to the editor application; engine packages remain framework-agnostic.

## MVP capabilities

Scene hierarchy; viewport; entity selection; inspector; transform gizmos; asset browser; material/geometry property editing; save/open; undo/redo; plugin registration contract. Voxel editing is a domain tool, not a separate world model.

## Architecture

`apps/editor` owns React shell, routing, panels and UI state. `engine-editor` owns editor document/session commands, selection, command history, gizmo abstractions, and plugin contracts. Viewport talks to renderer via adapter. Editing uses commands with apply/revert semantics; transactions group gestures.

## Dependencies

Public engine APIs, serialization, assets, renderer viewport integration. Editor-only packages cannot be imported by player.

## Performance

Viewport interaction must not trigger full React tree updates per frame. Use isolated render loop and event subscriptions. Large hierarchies use virtualization; asset thumbnails are lazy and cached.

## Errors

Unsaved changes are surfaced; failed save preserves dirty state. Unsupported plugin versions are disabled with diagnostics. Undo stack releases retained resources when discarded.

## Tests and acceptance

Command undo/redo round-trips, hierarchy selection, inspector editing, gizmo transforms, save/reopen, plugin isolation, and Playwright E2E smoke tests.

## M6 visual UX quality scope

M6 includes a bounded usability and truthfulness pass over the existing Editor, not completion of the full Editor MVP.

Current observed issues to resolve before calling the M6 integration usable:

- The top bar says `EDITOR · INTERACTIVE PREVIEW` and the inspector/footer use generic foundation/ready labels that do not describe actual subsystem health.
- The inspector displays static Mesh Renderer / Geometry rows with checkmarks rather than editable, authoritative component data.
- The current editor is a compact scene shell, not yet the full hierarchy/asset-browser/gizmo workflow described by the MVP.
- Technical diagnostics are available, but user-facing operation errors and empty states must remain visible and actionable.
- The desktop three-column layout has a 760px body minimum width; narrow/mobile behavior is handled separately and needs an explicit regression check.

M6 UX rules:

1. Do not display a feature as available unless its action works end-to-end. Remove, hide, or clearly mark placeholders; do not use decorative checkmarks or fake readiness indicators.
2. Distinguish application state (editing/play mode), renderer state, project dirty/saved state, and physics state. Each status must derive from a real source.
3. Preserve working hierarchy, viewport, transform editing, import, save/open, undo/redo, and diagnostics while reorganizing controls.
4. Keep the primary scene-editing surface visually dominant. Put secondary technical diagnostics and physics tuning in collapsible, labeled panels.
5. Show a clear empty-selection inspector state, a clear empty-scene state, loading progress, and actionable failures.
6. Use consistent spacing, readable labels, keyboard focus, adequate hit targets, and no horizontal overflow at supported desktop/mobile widths.
7. The Physics Playground is a focused sample/workspace for demonstrating M6, not a placeholder tab. Its controls must be wired to actual physics/input state.
8. Do not introduce decorative tabs, disabled controls without explanation, fake asset counts, or simulated values.

M6 visual acceptance is a limited quality gate, not a claim that the full Editor MVP (gizmos, asset browser, plugin system, full command/transaction history) is complete. See [M6 acceptance](acceptance/M6_PHYSICS_INPUT.md).

## Current implementation slice (in review)

The Editor currently has a bounded snapshot history for scene entity edits (100 snapshots), with Undo/Redo toolbar actions and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y shortcuts. Text-entry controls retain their native editing shortcuts. A new edit after undo clears the redo branch. This is an interim scene-document history service; it is not yet the planned engine-editor command/transaction system, and pointer gestures are not grouped into transactions.

Implementation and unit tests are tracked in PR #7. The Editor MVP exit gate remains open until the full command model, gizmos, asset workflow, save/reopen and browser E2E acceptance pass.

## GLB import integration slice

The Editor exposes an `Import .glb` action backed by `@engine/gltf-importer`. Imported triangle primitives become selectable scene entities. Metallic-roughness base color, roughness, metalness and alpha factors are mapped into the current renderer material descriptor. Imported CPU mesh buffers are retained in `.world` save/open documents and participate in entity snapshot Undo/Redo.

Current constraints: GLB 2.0 triangle meshes only; `EXT_meshopt_compression` and `KHR_mesh_quantization` are supported for mesh data. The editor resolves embedded PNG/JPEG/WebP image payloads to project texture assets, applies the five core PBR texture channels, glTF sampler settings, and `KHR_texture_transform`, and restores texture references from `.world`. A dedicated Console / Diagnostics panel reports importer, world-loading, and renderer errors separately from the scene hierarchy. External/data URI images remain unsupported. Matrix-authored affine nodes are decomposed into equivalent TRS transforms when they contain no shear; matrices with shear or non-affine components are rejected rather than approximated. Nested mesh-node hierarchies are still rejected. Flat-node TRS transforms are applied. Animation, skinning and morph targets are not supported by this Editor integration slice. Browser/WebGL visual acceptance and automated test execution remain separate validation gates.
