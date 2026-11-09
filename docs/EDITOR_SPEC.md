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
