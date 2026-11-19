import type { SystemContext, WorldSystem } from '@engine/core';
import {
  InputError,
  type InputActionDefinition,
  type InputBinding,
  type InputContext,
  type InputDeviceAdapter,
  type InputDeviceSample,
  type InputSnapshot,
  type InputSource,
} from './types.js';

const MAX_ACTIONS_PER_MAP = 128;
const MAX_BINDINGS_PER_MAP = 512;
const MAX_PENDING_TRANSITIONS = 2048;

const EMPTY_SNAPSHOT: InputSnapshot = Object.freeze({
  isPressed: () => false,
  wasPressed: () => false,
  wasReleased: () => false,
  getAxis1D: () => 0,
  getAxis2D: () => [0, 0] as const,
});

interface ActionState {
  readonly definition: InputActionDefinition;
  value: number | readonly [number, number];
  transientValue: number | readonly [number, number];
  pressed: boolean;
  wasPressed: boolean;
  wasReleased: boolean;
}

function validateMap(context: InputContext): void {
  if (!context.id.trim() || !context.map.id.trim())
    throw new InputError('input.invalid-map', 'Input context and map IDs must not be empty');
  if (!Number.isFinite(context.priority))
    throw new InputError('input.invalid-map', 'Input context priority must be finite');
  if (
    context.map.actions.length > MAX_ACTIONS_PER_MAP ||
    context.map.bindings.length > MAX_BINDINGS_PER_MAP
  )
    throw new InputError(
      'input.invalid-map',
      `Input map exceeds limits (${MAX_ACTIONS_PER_MAP} actions, ${MAX_BINDINGS_PER_MAP} bindings)`,
    );
  const actions = new Map<string, InputActionDefinition>();
  for (const action of context.map.actions) {
    if (!['button', 'axis1D', 'axis2D'].includes(action.kind))
      throw new InputError('input.invalid-map', `Unsupported action kind: ${String(action.kind)}`);
    if (!action.name.trim() || actions.has(action.name))
      throw new InputError('input.invalid-map', `Invalid or duplicate action: ${action.name}`);
    actions.set(action.name, action);
  }
  for (const binding of context.map.bindings) {
    if (!['keyboard', 'mouse', 'gamepad'].includes(binding.source))
      throw new InputError(
        'input.invalid-map',
        `Unsupported input source: ${String(binding.source)}`,
      );
    if (
      binding.modifiers &&
      binding.modifiers.some((modifier) => typeof modifier !== 'string' || !modifier.trim())
    )
      throw new InputError(
        'input.invalid-map',
        'Keyboard modifiers must be non-empty control codes',
      );
    if (binding.component !== undefined && binding.component !== 'x' && binding.component !== 'y')
      throw new InputError(
        'input.invalid-map',
        `Unsupported axis component: ${String(binding.component)}`,
      );
    if (!actions.has(binding.action))
      throw new InputError(
        'input.invalid-map',
        `Binding references unknown action: ${binding.action}`,
      );
    if (!binding.control.trim())
      throw new InputError('input.invalid-map', 'Binding control must not be empty');
    if (binding.scale !== undefined && !Number.isFinite(binding.scale))
      throw new InputError('input.invalid-map', 'Binding scale must be finite');
    if (
      binding.deadZone !== undefined &&
      (!Number.isFinite(binding.deadZone) || binding.deadZone < 0 || binding.deadZone >= 1)
    )
      throw new InputError('input.invalid-map', 'Dead zone must be in [0, 1)');
    const kind = actions.get(binding.action)!.kind;
    if (kind === 'axis2D' && !binding.component)
      throw new InputError(
        'input.invalid-map',
        `2D action ${binding.action} requires an x/y component`,
      );
    if (kind !== 'axis2D' && binding.component)
      throw new InputError(
        'input.invalid-map',
        `Only 2D actions accept a component: ${binding.action}`,
      );
  }
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function readValue(
  sample: InputDeviceSample | undefined,
  binding: InputBinding,
  keyboard?: InputDeviceSample,
): number {
  if (binding.modifiers?.some((modifier) => (keyboard?.values.get(modifier) ?? 0) <= 0)) return 0;
  const raw = sample?.values.get(binding.control) ?? 0;
  const deadZone = binding.deadZone ?? (binding.source === 'gamepad' ? 0.15 : 0);
  if (Math.abs(raw) <= deadZone) return 0;
  const adjusted =
    deadZone === 0 ? raw : (Math.sign(raw) * (Math.abs(raw) - deadZone)) / (1 - deadZone);
  return adjusted * (binding.scale ?? 1);
}

class Snapshot implements InputSnapshot {
  constructor(private readonly states: ReadonlyMap<string, ActionState>) {}
  isPressed(action: string): boolean {
    return this.#state(action).pressed;
  }
  wasPressed(action: string): boolean {
    return this.#state(action).wasPressed;
  }
  wasReleased(action: string): boolean {
    return this.#state(action).wasReleased;
  }
  getAxis1D(action: string): number {
    const state = this.#state(action);
    if (state.definition.kind !== 'axis1D')
      throw new InputError('input.action-kind', `${action} is not a 1D axis`);
    return state.value as number;
  }
  getAxis2D(action: string): readonly [number, number] {
    const state = this.#state(action);
    if (state.definition.kind !== 'axis2D')
      throw new InputError('input.action-kind', `${action} is not a 2D axis`);
    const [x, y] = state.value as readonly [number, number];
    const magnitude = Math.hypot(x, y);
    return magnitude > 1 ? [x / magnitude, y / magnitude] : [x, y];
  }
  #state(action: string): ActionState {
    const state = this.states.get(action);
    if (!state) throw new InputError('input.unknown-action', `Unknown input action: ${action}`);
    return state;
  }
}

/**
 * Resolves device samples into semantic actions. Call prepareFrame in pre-update and
 * fixedUpdate from fixed-update; edge transitions are exposed only on fixed tick zero.
 */
export class InputSystem {
  readonly #adapters: InputDeviceAdapter[] = [];
  readonly #contexts = new Map<string, InputContext>();
  readonly #disabledContexts = new Set<string>();
  readonly #pendingTransientValues = new Map<string, number>();
  #snapshots = new Map<string, InputSnapshot>();
  #pendingTransitions: Array<{ source: InputSource; control: string; pressed: boolean }> = [];
  #snapshot: InputSnapshot = EMPTY_SNAPSHOT;
  #defaultContextId: string | null = null;
  #preparedStates = new Map<string, ActionState>();
  #disposed = false;

  addAdapter(adapter: InputDeviceAdapter): void {
    this.#assertActive();
    if (this.#adapters.includes(adapter))
      throw new InputError('input.duplicate-adapter', 'Input adapter is already registered');
    this.#adapters.push(adapter);
  }

  addContext(context: InputContext): void {
    this.#assertActive();
    validateMap(context);
    if (this.#contexts.has(context.id))
      throw new InputError(
        'input.duplicate-context',
        `Input context already registered: ${context.id}`,
      );
    this.#contexts.set(context.id, context);
  }

  removeContext(id: string): boolean {
    this.#disabledContexts.delete(id);
    const removed = this.#contexts.delete(id);
    if (removed) this.#clearContextSnapshot(id);
    return removed;
  }

  enableContext(id: string): void {
    if (!this.#contexts.has(id))
      throw new InputError('input.unknown-context', `Unknown input context: ${id}`);
    this.#disabledContexts.delete(id);
  }

  disableContext(id: string): void {
    if (!this.#contexts.has(id))
      throw new InputError('input.unknown-context', `Unknown input context: ${id}`);
    this.#disabledContexts.add(id);
    this.#clearContextSnapshot(id);
  }

  prepareFrame(): void {
    this.#assertActive();
    const rawSamples = new Map<InputSource, InputDeviceSample>();
    for (const adapter of this.#adapters) {
      for (const sample of adapter.sample()) {
        const previous = rawSamples.get(sample.source);
        rawSamples.set(
          sample.source,
          previous
            ? {
                source: sample.source,
                values: new Map([...previous.values, ...sample.values]),
                transitions: [...previous.transitions, ...sample.transitions],
              }
            : sample,
        );
        if (
          sample.overflowed ||
          this.#pendingTransitions.length + sample.transitions.length > MAX_PENDING_TRANSITIONS
        )
          throw new InputError(
            'input.queue-overflow',
            'Input transition queue exceeded its configured limit',
          );
        this.#pendingTransitions.push(...sample.transitions);
      }
    }
    const contexts = [...this.#contexts.values()]
      .filter((context) => !this.#disabledContexts.has(context.id))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const transientControls = new Set<string>();
    for (const context of contexts) {
      for (const binding of context.map.bindings) {
        if (
          binding.transient ??
          (binding.source === 'mouse' && ['DeltaX', 'DeltaY', 'Wheel'].includes(binding.control))
        )
          transientControls.add(`${binding.source}:${binding.control}`);
      }
    }
    const samples = new Map<InputSource, InputDeviceSample>();
    for (const [source, sample] of rawSamples) {
      const values = new Map(sample.values);
      for (const [control, value] of sample.values) {
        const key = `${source}:${control}`;
        if (!transientControls.has(key)) continue;
        const accumulated = (this.#pendingTransientValues.get(key) ?? 0) + value;
        this.#pendingTransientValues.set(key, accumulated);
        values.set(control, accumulated);
      }
      samples.set(source, { ...sample, values });
    }
    this.#defaultContextId = contexts[0]?.id ?? null;
    const consumed = new Set<string>();
    const states = new Map<string, ActionState>();
    const pendingPressed = new Set<string>();
    const pendingReleased = new Set<string>();

    for (const context of contexts) {
      const actions = new Map<string, ActionState>(
        context.map.actions.map((action): [string, ActionState] => [
          action.name,
          {
            definition: action,
            value: action.kind === 'axis2D' ? ([0, 0] as readonly [number, number]) : 0,
            transientValue: action.kind === 'axis2D' ? ([0, 0] as readonly [number, number]) : 0,
            pressed: false,
            wasPressed: false,
            wasReleased: false,
          },
        ]),
      );
      const eligible = context.map.bindings.filter(
        (binding) => !consumed.has(`${binding.source}:${binding.control}`),
      );
      for (const binding of eligible) {
        const state = actions.get(binding.action)!;
        const value = readValue(samples.get(binding.source), binding, samples.get('keyboard'));
        const transient =
          binding.transient ??
          (binding.source === 'mouse' && ['DeltaX', 'DeltaY', 'Wheel'].includes(binding.control));
        if (state.definition.kind === 'button') {
          if (value > 0) state.pressed = true;
        } else if (state.definition.kind === 'axis1D') {
          const target = transient ? 'transientValue' : 'value';
          state[target] = clampAxis((state[target] as number) + value);
        } else {
          const target = transient ? 'transientValue' : 'value';
          const vector = state[target] as readonly [number, number];
          state[target] =
            binding.component === 'x'
              ? [clampAxis(vector[0] + value), vector[1]]
              : [vector[0], clampAxis(vector[1] + value)];
        }
        for (const transition of this.#pendingTransitions) {
          if (transition.source === binding.source && transition.control === binding.control) {
            if (transition.pressed) pendingPressed.add(`${context.id}:${binding.action}`);
            else pendingReleased.add(`${context.id}:${binding.action}`);
          }
        }
      }
      for (const [name, state] of actions) {
        const key = `${context.id}:${name}`;
        state.wasPressed = pendingPressed.has(key);
        state.wasReleased = pendingReleased.has(key);
        states.set(key, state);
      }
      if (context.consumeLowerPriority) {
        for (const binding of context.map.bindings)
          consumed.add(`${binding.source}:${binding.control}`);
      }
    }
    this.#preparedStates = states;
  }

  fixedUpdate(context: SystemContext): void {
    this.#assertActive();
    const firstTick = context.fixedStepIndex === undefined || context.fixedStepIndex === 0;
    const snapshots = new Map<string, InputSnapshot>();
    for (const context of this.#contexts.values()) {
      if (this.#disabledContexts.has(context.id)) continue;
      const states = new Map<string, ActionState>();
      for (const action of context.map.actions) {
        const state = this.#preparedStates.get(`${context.id}:${action.name}`);
        if (!state) continue;
        let value = state.value;
        if (action.kind === 'axis1D') {
          value = clampAxis(
            (state.value as number) + (firstTick ? (state.transientValue as number) : 0),
          );
        } else if (action.kind === 'axis2D') {
          const persistent = state.value as readonly [number, number];
          const transient = state.transientValue as readonly [number, number];
          value = [
            clampAxis(persistent[0] + (firstTick ? transient[0] : 0)),
            clampAxis(persistent[1] + (firstTick ? transient[1] : 0)),
          ];
        }
        states.set(action.name, {
          ...state,
          value,
          wasPressed: firstTick && state.wasPressed,
          wasReleased: firstTick && state.wasReleased,
        });
      }
      snapshots.set(context.id, new Snapshot(states));
    }
    this.#snapshots = snapshots;
    this.#snapshot = this.#defaultContextId
      ? (snapshots.get(this.#defaultContextId) ?? EMPTY_SNAPSHOT)
      : EMPTY_SNAPSHOT;
    if (firstTick) {
      this.#pendingTransitions = [];
      this.#pendingTransientValues.clear();
    }
  }

  snapshot(contextId?: string): InputSnapshot {
    if (!contextId) return this.#snapshot;
    if (!this.#contexts.has(contextId))
      throw new InputError('input.unknown-context', `Unknown input context: ${contextId}`);
    if (this.#disabledContexts.has(contextId))
      throw new InputError('input.context-disabled', `Input context is disabled: ${contextId}`);
    const snapshot = this.#snapshots.get(contextId);
    if (!snapshot)
      throw new InputError(
        'input.snapshot-unavailable',
        `No fixed-tick snapshot is available for context: ${contextId}`,
      );
    return snapshot;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const adapter of this.#adapters) adapter.dispose();
    this.#adapters.length = 0;
    this.#contexts.clear();
    this.#disabledContexts.clear();
    this.#pendingTransientValues.clear();
    this.#pendingTransitions = [];
    this.#preparedStates.clear();
    this.#snapshot = EMPTY_SNAPSHOT;
    this.#defaultContextId = null;
    this.#snapshots.clear();
  }

  #clearContextSnapshot(id: string): void {
    for (const key of this.#preparedStates.keys())
      if (key.startsWith(`${id}:`)) this.#preparedStates.delete(key);
    this.#snapshots.delete(id);
    if (this.#defaultContextId === id) {
      this.#defaultContextId = null;
      this.#snapshot = EMPTY_SNAPSHOT;
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new InputError('input.disposed', 'Input system has been disposed');
  }
}

export class InputPreUpdateSystem implements WorldSystem {
  readonly phase = 'pre-update' as const;
  constructor(readonly input: InputSystem) {}
  update(): void {
    this.input.prepareFrame();
  }
}

export class InputFixedUpdateSystem implements WorldSystem {
  readonly phase = 'fixed-update' as const;
  constructor(readonly input: InputSystem) {}
  update(context: SystemContext): void {
    this.input.fixedUpdate(context);
  }
}
