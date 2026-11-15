# Input Specification

**Status:** M6 contract draft; implementation in progress  
**Target package:** `@engine/input` (initial implementation present; acceptance remains open)  
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

| Device   | M6 baseline               | Notes                                                                                     |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| Keyboard | Required                  | Physical code based bindings; ignore key-repeat for edge transitions                      |
| Mouse    | Required                  | Buttons, position, movement and wheel; pointer lock is optional and not required for exit |
| Gamepad  | Required baseline adapter | Standard Gamepad mapping, connection/disconnection, axis dead zones                       |
| Touch    | Deferred                  | Editor viewport gestures remain app-owned; no general touch action map in M6              |

Browser adapter owns DOM listeners on an explicitly supplied target. It must detach every listener and release pointer-lock/focus hooks on dispose.

## 3. Public concepts

- **InputSource** — keyboard, mouse, or gamepad physical control namespace.
- **InputAction** — named semantic action with declared value kind: `button`, `axis1D`, or `axis2D`.
- **InputBinding** — maps a physical control plus modifiers/scale/dead-zone settings to an action.
- **InputMap** — collection of action declarations and physical bindings.
- **InputContext** — enabled map with priority and optional consumption of lower-priority bindings.
- **InputSnapshot** — immutable state for one simulation tick.
- **InputSystem** — samples adapters, resolves contexts, and publishes snapshots.

Implemented API shape (contract remains provisional until M6 acceptance):

```ts
interface InputSnapshot {
  isPressed(action: string): boolean;
  wasPressed(action: string): boolean;
  wasReleased(action: string): boolean;
  getAxis1D(action: string): number;
  getAxis2D(action: string): readonly [number, number];
}

interface InputSystem {
  addAdapter(adapter: InputDeviceAdapter): void;
  addContext(context: InputContext): void;
  enableContext(id: string): void;
  disableContext(id: string): void;
  prepareFrame(): void;
  fixedUpdate(context: SystemContext): void;
  snapshot(contextId?: string): InputSnapshot;
  dispose(): void;
}
```

No method may return a mutable internal buffer. Unknown action/context names throw `InputError` with stable codes. Snapshots are immutable and action names are scoped to a context; `snapshot()` without an ID reads the highest-priority active context.

## 4. Sampling and fixed-step semantics

The runtime already provides `EngineClock` and scheduler phases. `SystemContext` now carries `fixedStepIndex` and `fixedStepCount` on fixed-update ticks. Input MUST NOT introduce a second frame clock or fixed-step accumulator. Register `InputPreUpdateSystem` in `pre-update` and `InputFixedUpdateSystem` before gameplay fixed systems so the snapshot is ready for consumers.

1. Browser/device adapters enqueue physical transitions and update latest analog values.
2. During `pre-update`, InputSystem drains the event queue, updates device state, resolves active contexts, and stages an immutable frame sample.
3. The staged sample is resolved into one immutable snapshot per active context on each fixed tick.
4. Press/release edges are delivered only to fixed tick index zero; later ticks in the same rendered frame see held state but no repeated edge.
5. If a rendered frame has no fixed tick, edge transitions remain pending; they must not be lost. A press and release between ticks preserve both edges.
6. Mouse delta and wheel bindings are transient: values accumulate across rendered frames with no fixed tick, are delivered once to the first fixed tick, and are zero on later ticks.
7. Held keyboard/mouse/gamepad button state and non-transient analog values remain visible to every fixed tick in that rendered frame.
8. Variable-update UI should not use gameplay snapshots as a substitute for a separate UI input path.

`InputPreUpdateSystem` stages the frame; `InputFixedUpdateSystem` uses the explicit fixed-step index to consume edges/transient values once. The scheduler owns the clock and tick count.

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
- A disconnected gamepad immediately neutralizes its button and axis values. A separate device lifecycle event stream is not yet implemented.
- Repeated keydown events do not create repeated `wasPressed` edges.
- Pointer lock is not acquired by the M6 browser adapter. If a host later enables pointer lock, that host must neutralize mouse state on lock loss.
- Disposal is idempotent, removes listeners, clears queues, neutralizes snapshots, and releases references to DOM targets.
- No input event listener may be installed at module import time.

## 7. Validation and errors

Use stable error categories, not message-string matching:

- `input.invalid-map` — malformed action or binding declaration.
- `input.unknown-action` — requested action is not declared.
- `input.duplicate-context` — duplicate context identity.
- `input.unsupported-control` — binding references an unsupported control.
- `input.adapter-unavailable` — reserved for an unavailable device adapter.
- `input.queue-overflow` — bounded transition queue overflow.

Validate at map registration boundaries: non-empty IDs, unique action IDs per map, finite scales/dead zones, valid value-kind/binding compatibility, and limits of 128 actions / 512 bindings per map. Transition queues are bounded (1,024 adapter events; 2,048 pending system events) and overflow is surfaced as `input.queue-overflow`.

## 8. Performance and security

- Bound queued event count and report overflow; do not silently grow without limit.
- Avoid per-frame allocations in device polling and snapshot hot paths where practical.
- Do not persist raw keystrokes or device identifiers by default.
- Treat browser event payloads and imported input maps as untrusted data.
- Input maps are data only; they cannot execute arbitrary scripts.

## 9. Tests and acceptance

Implemented tests cover keyboard press/release and repeat suppression, press+release between frames, zero/multiple fixed steps, transient mouse delta accumulation, modifier matching, axis normalization/dead zone, context priority/enable/disable, focus-loss neutralization, listener disposal, and physics-independent snapshot behavior. Gamepad browser hardware, queue overflow, and full browser E2E remain open acceptance items.

## 10. Compatibility and open decisions

The 0.1.0 contract is provisional, not stable. Browser adapter uses `KeyboardEvent.code`, `MouseEvent.button`, `Gamepad0:ButtonN`, and `Gamepad0:AxisN` control names. Mouse delta/wheel are accumulated until one fixed tick. Pointer lock, touch action maps, device lifecycle events, and user-facing binding-remap UI are outside the current implementation scope; hardware/browser coverage remains part of M6 acceptance.
