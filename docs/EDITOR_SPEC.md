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

## Current implementation slice (in review)

The Editor currently has a bounded snapshot history for scene entity edits (100 snapshots), with Undo/Redo toolbar actions and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y shortcuts. Text-entry controls retain their native editing shortcuts. A new edit after undo clears the redo branch. This is an interim scene-document history service; it is not yet the planned engine-editor command/transaction system, and pointer gestures are not grouped into transactions.

Implementation and unit tests are tracked in PR #7. The Editor MVP exit gate remains open until the full command model, gizmos, asset workflow, save/reopen and browser E2E acceptance pass.


## GLB import integration slice

The Editor exposes an `Import .glb` action backed by `@engine/gltf-importer`. Imported triangle primitives become selectable scene entities. Metallic-roughness base color, roughness, metalness and alpha factors are mapped into the current renderer material descriptor. Imported CPU mesh buffers are retained in `.world` save/open documents and participate in entity snapshot Undo/Redo.

Current constraints: GLB 2.0 triangle meshes only. The importer now copies embedded PNG/JPEG image payloads from GLB bufferViews and retains sampler settings plus texture-to-image references; this is encoded source data only and is not yet connected to Editor materials or GPU texture upload. External/data URI images remain unsupported. Matrix-authored affine nodes are decomposed into equivalent TRS transforms when they contain no shear; matrices with shear or non-affine components are rejected rather than approximated. Nested mesh-node hierarchies are still rejected. Flat-node TRS transforms are applied. Animation, skinning and morph targets are not supported by this Editor integration slice. Browser/WebGL visual acceptance and automated test execution remain separate validation gates.
