# Input Specification

**Status:** proposed M6 contract  
**Target package:** `@engine/input` (not yet implemented)  
**Contract version:** 0.1.0

## 1. Responsibility and boundaries

Provide a framework-independent, device-independent input layer for Choreon runtime and editor tools. Convert browser/device events into stable physical state and semantic actions.

- `engine-input` owns device adapters, action maps, contexts, snapshots, and lifecycle.
- `engine-core` owns runtime phases and ECS scheduling; input integrates through documented phase hooks and does not own the clock.
- `apps/player` and `apps/editor` own DOM targets and application-level focus policy.
- Game systems consume semantic actions, never DOM events.
- Physics has no dependency on input; gameplay code may use input to issue forces or kinematic targets.

React, renderer, physics backend, and browser globals MUST NOT leak into the public core contracts.

## 2. M6 supported devices

| Device | M6 baseline | Notes |
| --- | --- | --- |
| Keyboard | Required | Physical code based bindings; ignore key-repeat for edge transitions |
| Mouse | Required | Buttons, position, movement and wheel; pointer lock is optional and not required for exit |
| Gamepad | Required baseline adapter | Standard Gamepad mapping, connection/disconnection, axis dead zones |
| Touch | Deferred | Editor viewport gestures remain app-owned; no general touch action map in M6 |

Browser adapter owns DOM listeners on an explicitly supplied target. It must detach every listener and release pointer-lock/focus hooks on dispose.

## 3. Public concepts

- **InputDevice** — physical source with stable device identity and lifecycle.
- **InputAction** — named semantic action with declared value kind: `button`, `axis1D`, or `axis2D`.
- **InputBinding** — maps a physical control plus modifiers/scale/dead-zone settings to an action.
- **InputMap** — versioned collection of action declarations and bindings.
- **InputContext** — enabled map with priority and optional consumption of lower-priority bindings.
- **InputSnapshot** — immutable state for one simulation tick.
- **InputSystem** — samples adapters, resolves contexts, and publishes snapshots.

Initial public API shape (names are proposed and must be checked against implementation conventions before code):

```ts
interface InputSnapshot {
  isPressed(action: string): boolean;
  wasPressed(action: string): boolean;
  wasReleased(action: string): boolean;
  getAxis1D(action: string): number;
  getAxis2D(action: string): readonly [number, number];
}

interface InputSystem {
  enableContext(id: string): void;
  disableContext(id: string): void;
  getSnapshot(): InputSnapshot;
  dispose(): void;
}
```

No method may return a mutable internal buffer. Unknown action names return a typed diagnostic or a documented neutral value; the final choice must be consistent across the package and tests.

## 4. Sampling and fixed-step semantics

The runtime already provides `EngineClock` and scheduler phases. Input MUST NOT introduce a second frame clock or fixed-step accumulator.

1. Browser/device adapters enqueue physical transitions and update latest analog values.
2. During `pre-update`, InputSystem drains the event queue, updates device state, resolves active contexts, and stages an immutable frame sample.
3. Before each `fixed-update` tick, the staged sample is exposed as the current simulation snapshot.
4. A press/release edge is delivered to exactly one fixed tick, even when a rendered frame contains multiple fixed ticks.
5. If a rendered frame has no fixed tick, edge transitions remain pending; they must not be lost.
6. Held state and analog values remain visible to every fixed tick in that rendered frame.
7. Multiple transitions in one frame preserve order. A press and release between two rendered frames must not silently disappear.
8. Variable-update may read a separate latest-frame view for UI only; gameplay decisions should use fixed-tick snapshots.

The exact scheduler hook needed to expose a per-fixed-tick snapshot must be specified in the integration design; do not mutate `SystemContext` ad hoc or add hidden global state.

## 5. Mapping rules

- Keyboard bindings use `KeyboardEvent.code` rather than locale-dependent key labels.
- Modifiers are explicit and matching is deterministic.
- Axis values are finite and clamped to [-1, 1] unless an action declaration specifies another documented range.
- Gamepad axes apply configurable dead zone and rescaling outside the dead zone; default dead zone is 0.15.
- Digital-to-axis bindings have explicit scale and combine policy.
- Multiple active bindings use a documented combine policy (`maxMagnitude` for vectors and signed strongest-magnitude for scalar axes is the proposed default).
- Context priority is descending. A consuming higher-priority context prevents lower-priority contexts from receiving the same physical binding.
- Context activation/deactivation is idempotent and ordered.

## 6. Focus, disconnect and lifecycle

- On window blur, document visibility loss, or target focus loss as configured by the host, pressed keyboard/mouse controls are released and analog values neutralized.
- A disconnected gamepad immediately neutralizes its controls and emits a device lifecycle event.
- Repeated keydown events do not create repeated `wasPressed` edges.
- Pointer-lock loss is observable and must not leave a mouse button logically stuck.
- Disposal is idempotent, removes listeners, clears queues, neutralizes snapshots, and releases references to DOM targets.
- No input event listener may be installed at module import time.

## 7. Validation and errors

Use stable error categories, not message-string matching:

- `input.invalid-map` — malformed action or binding declaration.
- `input.unknown-action` — requested action is not declared.
- `input.duplicate-context` — duplicate context identity.
- `input.unsupported-control` — binding references an unsupported control.
- `input.adapter-unavailable` — device API is absent or unavailable.

Validate at map registration boundaries: non-empty IDs, unique action IDs per map, finite scales/dead zones, valid value-kind/binding compatibility, and bounded binding counts.

## 8. Performance and security

- Bound queued event count and report overflow; do not silently grow without limit.
- Avoid per-frame allocations in device polling and snapshot hot paths where practical.
- Do not persist raw keystrokes or device identifiers by default.
- Treat browser event payloads and imported input maps as untrusted data.
- Input maps are data only; they cannot execute arbitrary scripts.

## 9. Tests and acceptance

Required tests: keyboard press/hold/release, key-repeat suppression, press+release between frames, zero/multiple fixed steps, modifier matching, axis clamping/dead zone, context priority/consumption, gamepad connect/disconnect, focus loss neutralization, listener disposal, queue overflow, invalid-map diagnostics, and browser adapter E2E smoke test.

## 10. Compatibility and open decisions

The 0.1.0 contract is proposed, not stable. Before implementation, confirm naming and package conventions, exact scheduler integration, standard gamepad mapping, context consumption behavior, and whether mouse delta is sampled per frame or accumulated per fixed tick. Touch action maps and user-facing binding-remap UI are outside M6.
