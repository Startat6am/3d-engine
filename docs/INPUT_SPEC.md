# Input Specification

**Status:** M6 implementation in progress; public contract 0.1.0 is provisional  
**Target package:** `@engine/input`  
**Acceptance:** [M6 Physics & Input](acceptance/M6_PHYSICS_INPUT.md)

## 1. Responsibility and boundaries

Provide a framework-independent, device-independent input layer for Choreon runtime and editor tools. Convert browser/device events into stable physical state and semantic actions.

- `engine-input` owns device adapters, action maps, contexts, snapshots, and listener lifecycle.
- `engine-core` owns runtime phases and ECS scheduling; input does not own a clock or accumulator.
- `apps/player` and `apps/editor` own DOM targets and application-level focus policy.
- Gameplay systems consume semantic actions, never DOM events.
- Physics has no dependency on input; gameplay may use input to issue forces or kinematic targets.
- React, renderer, physics backend, and browser globals do not leak into public input contracts. Browser globals are confined to `BrowserInputAdapter`.

## 2. M6 device support

| Device   | Initial implementation | Notes                                                                                                           |
| -------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Keyboard | Implemented            | `KeyboardEvent.code`; repeat keydown is ignored                                                                 |
| Mouse    | Implemented            | Buttons, movement delta, and wheel; absolute pointer position and pointer lock are not implemented              |
| Gamepad  | Implemented adapter    | Standard Gamepad API button/axis polling and disconnect neutralization; physical hardware coverage remains open |
| Touch    | Deferred               | Editor viewport gestures remain app-owned; no general touch action map in M6                                    |

`BrowserInputAdapter` receives an explicit `Window` target and returns samples for keyboard, mouse, and gamepad sources. It installs no listeners at module import time and removes every listener on disposal.

## 3. Public concepts and API

- **InputSource:** `keyboard`, `mouse`, or `gamepad` physical-control namespace.
- **InputAction:** named semantic action with value kind `button`, `axis1D`, or `axis2D`.
- **InputBinding:** maps a physical control plus optional keyboard modifiers, scale, dead zone, axis component, and transient flag to an action.
- **InputMap:** action declarations and physical bindings.
- **InputContext:** a map with priority and optional `consumeLowerPriority` behavior.
- **InputSnapshot:** immutable action state for one simulation tick.
- **InputDeviceAdapter:** samples one or more source snapshots and owns its disposal lifecycle.

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
  removeContext(id: string): boolean;
  enableContext(id: string): void;
  disableContext(id: string): void;
  prepareFrame(): void;
  fixedUpdate(context: SystemContext): void;
  snapshot(contextId?: string): InputSnapshot;
  dispose(): void;
}
```

Action names are scoped to a context. `snapshot(contextId)` reads a named active context; `snapshot()` reads the highest-priority active context. Unknown/disabled contexts and unknown actions throw `InputError` with stable codes. Snapshot values are immutable copies, not mutable internal buffers.

## 4. Sampling and fixed-step semantics

The runtime's `EngineClock` is the only frame clock. `SystemContext` carries `fixedStepIndex` and `fixedStepCount` on fixed-update ticks. Register `InputPreUpdateSystem` in `pre-update` and `InputFixedUpdateSystem` before gameplay fixed systems.

1. Browser adapters collect physical transitions and latest continuous values.
2. During `pre-update`, `InputSystem` drains adapter samples, accumulates transient values, resolves active contexts, and stages action states.
3. `InputFixedUpdateSystem` publishes one immutable snapshot per active context for each fixed tick.
4. Press/release edges are visible only on fixed tick index zero. Later ticks in the same rendered frame see held state but not repeated edges.
5. If a rendered frame has no fixed tick, press/release transitions remain pending; a press and release between ticks preserve both edges.
6. Mouse delta and wheel bindings are transient by default: they accumulate across rendered frames with no fixed tick, are delivered once to the first fixed tick, and are zero on later ticks in the same frame.
7. Held button state and non-transient analog values remain visible to every fixed tick in that rendered frame.

The scheduler owns tick count and cadence. Input never creates a second accumulator.

## 5. Mapping rules

- Keyboard bindings use `KeyboardEvent.code`, not locale-dependent key labels.
- Modifiers are explicit physical control codes (for example `ShiftLeft` or `ControlLeft`).
- Axis values are finite and clamped to [-1, 1].
- Multiple bindings are summed and clamped; 2D vectors are normalized to magnitude no greater than one.
- Gamepad axes apply configurable dead-zone and rescaling; the default dead zone is 0.15.
- Digital-to-axis bindings use explicit scale and `x`/`y` component.
- Gamepad controls use names such as `Gamepad0:Button0` and `Gamepad0:Axis0`.
- Contexts resolve in descending priority, then stable ID order. A consuming higher-priority context prevents lower-priority contexts from receiving the same physical binding.
- Context enable/disable is explicit and idempotent.

## 6. Focus, disconnect and lifecycle

- Window blur and document visibility loss release pressed keyboard/mouse controls and neutralize analog values.
- A disconnected gamepad immediately neutralizes its button and axis values. A separate device lifecycle event stream is not implemented yet.
- Repeated keydown events do not create repeated `wasPressed` edges.
- Pointer lock is not acquired by the M6 adapter. If a host later enables it, the host must neutralize mouse state on lock loss.
- Disposal is idempotent, removes listeners, clears queues, neutralizes snapshots, and releases DOM references.
- No listener is installed at module import time.

## 7. Validation, errors and limits

Stable errors include:

- `input.invalid-map` — malformed action/binding or map limits exceeded.
- `input.unknown-action` — requested action is not declared.
- `input.duplicate-context` — duplicate context identity.
- `input.unknown-context` / `input.context-disabled` — context is absent or inactive.
- `input.snapshot-unavailable` — no fixed-tick snapshot exists yet.
- `input.action-kind` — axis accessor used with an incompatible action kind.
- `input.duplicate-adapter` — same adapter registered twice.
- `input.queue-overflow` — bounded transition queue overflow.

Map limits are 128 actions and 512 bindings. Browser adapter transition queue is limited to 1,024 events; the system pending queue is limited to 2,048 events. Overflow is surfaced, not silently dropped. Unsupported-control and adapter-unavailable categories are reserved for future device-specific validation.

## 8. Performance and security

- Avoid per-frame allocations in device polling and snapshot hot paths where practical.
- Do not persist raw keystrokes or device identifiers by default.
- Treat browser event payloads and imported input maps as untrusted data.
- Input maps are data only; they cannot execute scripts.

## 9. Tests and remaining acceptance

Unit tests cover keyboard press/release and repeat suppression, press+release between frames, zero/multiple fixed steps, transient mouse delta accumulation, modifiers, vector normalization, gamepad dead-zone mapping, context priority/enable/disable, focus-loss neutralization, listener disposal, queue overflow, and invalid maps.

Remaining M6 evidence: physical gamepad coverage in supported browsers, full input E2E in Player, and integration with the Physics Playground. Touch maps, pointer lock, absolute mouse position, device lifecycle events, and user-facing remapping UI are outside M6.
