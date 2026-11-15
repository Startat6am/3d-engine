import { describe, expect, it, vi } from 'vitest';
import { EngineRuntime } from '@engine/core';
import { InputFixedUpdateSystem, InputPreUpdateSystem, InputSystem } from './input-system.js';
import type { InputDeviceAdapter, InputDeviceSample, InputSource } from './types.js';

class FakeAdapter implements InputDeviceAdapter {
  readonly #queue: InputDeviceSample[][] = [];
  readonly dispose = vi.fn();
  push(...samples: InputDeviceSample[]): void {
    this.#queue.push(samples);
  }
  sample(): readonly InputDeviceSample[] {
    return this.#queue.shift() ?? [];
  }
}

function sample(
  source: InputSource,
  values: Record<string, number>,
  transitions: InputDeviceSample['transitions'] = [],
): InputDeviceSample {
  return { source, values: new Map(Object.entries(values)), transitions };
}

const gameplayMap = {
  id: 'gameplay',
  actions: [
    { name: 'Jump', kind: 'button' as const },
    { name: 'Move', kind: 'axis2D' as const },
    { name: 'Look', kind: 'axis1D' as const },
  ],
  bindings: [
    { action: 'Jump', source: 'keyboard' as const, control: 'Space' },
    { action: 'Move', source: 'keyboard' as const, control: 'KeyD', component: 'x' as const },
    {
      action: 'Move',
      source: 'keyboard' as const,
      control: 'KeyA',
      component: 'x' as const,
      scale: -1,
    },
    { action: 'Look', source: 'mouse' as const, control: 'DeltaX', scale: 0.01 },
  ],
};

describe('InputSystem', () => {
  it('maps physical controls to semantic actions and consumes edges on the first fixed tick only', () => {
    const input = new InputSystem();
    const keyboard = new FakeAdapter();
    const mouse = new FakeAdapter();
    input.addAdapter(keyboard);
    input.addAdapter(mouse);
    input.addContext({ id: 'gameplay', map: gameplayMap, priority: 0 });
    const runtime = new EngineRuntime({ fixedDeltaTime: 0.1 });
    runtime.scheduler.add(new InputPreUpdateSystem(input));
    runtime.scheduler.add(new InputFixedUpdateSystem(input));
    const seen: Array<[boolean, boolean, number, number]> = [];
    runtime.scheduler.add({
      phase: 'fixed-update',
      update: () => {
        const snapshot = input.snapshot('gameplay');
        seen.push([
          snapshot.isPressed('Jump'),
          snapshot.wasPressed('Jump'),
          snapshot.getAxis2D('Move')[0],
          snapshot.getAxis1D('Look'),
        ]);
      },
    });

    keyboard.push(
      sample('keyboard', { Space: 1, KeyD: 1 }, [
        { source: 'keyboard', control: 'Space', pressed: true },
      ]),
    );
    mouse.push(sample('mouse', { DeltaX: 12 }));
    runtime.advance(0.25); // two fixed ticks

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual([true, true, 1, 0.12]);
    expect(seen[1]).toEqual([true, false, 1, 0]);
    input.dispose();
  });

  it('accumulates transient mouse deltas until the first fixed tick only', () => {
    const input = new InputSystem();
    const mouse = new FakeAdapter();
    input.addAdapter(mouse);
    input.addContext({
      id: 'gameplay',
      map: {
        id: 'look-map',
        actions: [{ name: 'Look', kind: 'axis1D' }],
        bindings: [{ action: 'Look', source: 'mouse', control: 'DeltaX', scale: 0.01 }],
      },
      priority: 0,
    });
    const runtime = new EngineRuntime({ fixedDeltaTime: 0.1 });
    runtime.scheduler.add(new InputPreUpdateSystem(input));
    runtime.scheduler.add(new InputFixedUpdateSystem(input));
    const values: number[] = [];
    runtime.scheduler.add({
      phase: 'fixed-update',
      update: () => values.push(input.snapshot('gameplay').getAxis1D('Look')),
    });
    runtime.advance(0.02);
    mouse.push(sample('mouse', { DeltaX: 10 }));
    runtime.advance(0.02);
    mouse.push(sample('mouse', { DeltaX: 20 }));
    runtime.advance(0.06);
    expect(values).toHaveLength(1);
    expect(values[0]).toBeCloseTo(0.3);
    runtime.advance(0.1);
    expect(values[1]).toBe(0);
  });

  it('retains press and release edges when a rendered frame has no fixed tick', () => {
    const input = new InputSystem();
    const keyboard = new FakeAdapter();
    input.addAdapter(keyboard);
    input.addContext({ id: 'gameplay', map: gameplayMap, priority: 0 });
    const runtime = new EngineRuntime({ fixedDeltaTime: 0.1 });
    runtime.scheduler.add(new InputPreUpdateSystem(input));
    runtime.scheduler.add(new InputFixedUpdateSystem(input));
    runtime.advance(0.02);
    keyboard.push(
      sample('keyboard', {}, [
        { source: 'keyboard', control: 'Space', pressed: true },
        { source: 'keyboard', control: 'Space', pressed: false },
      ]),
    );
    runtime.advance(0.02);
    runtime.advance(0.06);
    const snapshot = input.snapshot('gameplay');
    expect(snapshot.isPressed('Jump')).toBe(false);
    expect(snapshot.wasPressed('Jump')).toBe(true);
    expect(snapshot.wasReleased('Jump')).toBe(true);
  });

  it('applies keyboard modifiers, gamepad dead zones, and normalizes diagonal vectors', () => {
    const input = new InputSystem();
    const keyboard = new FakeAdapter();
    const gamepad = new FakeAdapter();
    keyboard.push(sample('keyboard', { ShiftLeft: 0, KeyW: 1, KeyD: 1 }));
    gamepad.push(sample('gamepad', { 'Gamepad0:Axis0': 0.1 }));
    input.addAdapter(keyboard);
    input.addAdapter(gamepad);
    input.addContext({
      id: 'gameplay',
      map: {
        id: 'movement',
        actions: [
          { name: 'Move', kind: 'axis2D' },
          { name: 'Sprint', kind: 'button' },
          { name: 'Steer', kind: 'axis1D' },
        ],
        bindings: [
          { action: 'Move', source: 'keyboard', control: 'KeyW', component: 'y' },
          { action: 'Move', source: 'keyboard', control: 'KeyD', component: 'x' },
          { action: 'Sprint', source: 'keyboard', control: 'KeyW', modifiers: ['ShiftLeft'] },
          { action: 'Steer', source: 'gamepad', control: 'Gamepad0:Axis0' },
        ],
      },
      priority: 0,
    });
    input.prepareFrame();
    input.fixedUpdate({
      world: new EngineRuntime().world,
      deltaTime: 1 / 60,
      elapsedTime: 1 / 60,
      fixedStepIndex: 0,
      fixedStepCount: 1,
    });
    const move = input.snapshot('gameplay').getAxis2D('Move');
    expect(move[0]).toBeCloseTo(Math.SQRT1_2);
    expect(move[1]).toBeCloseTo(Math.SQRT1_2);
    expect(input.snapshot('gameplay').isPressed('Sprint')).toBe(false);
    expect(input.snapshot('gameplay').getAxis1D('Steer')).toBe(0);
  });

  it('enables and disables input contexts explicitly', () => {
    const input = new InputSystem();
    const keyboard = new FakeAdapter();
    keyboard.push(sample('keyboard', { Space: 1 }));
    input.addAdapter(keyboard);
    input.addContext({ id: 'gameplay', map: gameplayMap, priority: 0 });
    input.disableContext('gameplay');
    input.prepareFrame();
    input.fixedUpdate({
      world: new EngineRuntime().world,
      deltaTime: 1 / 60,
      elapsedTime: 1 / 60,
      fixedStepIndex: 0,
      fixedStepCount: 1,
    });
    expect(() => input.snapshot('gameplay')).toThrow('Input context is disabled');
    input.enableContext('gameplay');
    keyboard.push(sample('keyboard', { Space: 1 }));
    input.prepareFrame();
    input.fixedUpdate({
      world: new EngineRuntime().world,
      deltaTime: 1 / 60,
      elapsedTime: 1 / 60,
      fixedStepIndex: 0,
      fixedStepCount: 1,
    });
    expect(input.snapshot('gameplay').isPressed('Jump')).toBe(true);
  });

  it('prioritizes consuming contexts and validates maps', () => {
    const input = new InputSystem();
    const keyboard = new FakeAdapter();
    keyboard.push(
      sample('keyboard', { Escape: 1 }, [{ source: 'keyboard', control: 'Escape', pressed: true }]),
    );
    input.addAdapter(keyboard);
    input.addContext({
      id: 'modal',
      map: {
        id: 'modal-map',
        actions: [{ name: 'Close', kind: 'button' }],
        bindings: [{ action: 'Close', source: 'keyboard', control: 'Escape' }],
      },
      priority: 10,
      consumeLowerPriority: true,
    });
    input.addContext({
      id: 'gameplay',
      map: {
        id: 'gameplay-map',
        actions: [{ name: 'Pause', kind: 'button' }],
        bindings: [{ action: 'Pause', source: 'keyboard', control: 'Escape' }],
      },
      priority: 0,
    });
    input.prepareFrame();
    input.fixedUpdate({
      world: new EngineRuntime().world,
      deltaTime: 1 / 60,
      elapsedTime: 1 / 60,
      fixedStepIndex: 0,
      fixedStepCount: 1,
    });
    expect(input.snapshot('modal').wasPressed('Close')).toBe(true);
    expect(input.snapshot('gameplay').wasPressed('Pause')).toBe(false);
    expect(() =>
      input.addContext({
        id: 'bad',
        map: {
          id: 'bad',
          actions: [{ name: 'Move', kind: 'axis2D' }],
          bindings: [{ action: 'Move', source: 'keyboard', control: 'KeyW' }],
        },
        priority: 0,
      }),
    ).toThrow('requires an x/y component');
  });

  it('reports adapter transition queue overflow instead of silently dropping input', () => {
    const input = new InputSystem();
    const adapter = new FakeAdapter();
    input.addAdapter(adapter);
    input.addContext({ id: 'gameplay', map: gameplayMap, priority: 0 });
    adapter.push({ source: 'keyboard', values: new Map(), transitions: [], overflowed: true });
    expect(() => input.prepareFrame()).toThrow('queue exceeded');
  });

  it('disposes each adapter once and rejects use after disposal', () => {
    const input = new InputSystem();
    const adapter = new FakeAdapter();
    input.addAdapter(adapter);
    input.dispose();
    input.dispose();
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    expect(() => input.prepareFrame()).toThrow('disposed');
  });
});

describe('BrowserInputAdapter', () => {
  it('tracks keyboard transitions, ignores repeat keydown and releases controls on blur', async () => {
    const { BrowserInputAdapter } = await import('./browser-adapter.js');
    const target = new EventTarget() as Window;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    Object.defineProperty(target, 'document', { value: documentTarget });
    Object.defineProperty(target, 'navigator', { value: { getGamepads: () => [] } });
    const adapter = new BrowserInputAdapter(target);
    const down = new Event('keydown') as KeyboardEvent;
    Object.defineProperties(down, {
      code: { value: 'Space' },
      repeat: { value: false },
      isComposing: { value: false },
    });
    target.dispatchEvent(down);
    const repeat = new Event('keydown') as KeyboardEvent;
    Object.defineProperties(repeat, {
      code: { value: 'Space' },
      repeat: { value: true },
      isComposing: { value: false },
    });
    target.dispatchEvent(repeat);
    const pressed = adapter.sample().find((item) => item.source === 'keyboard')!;
    expect(pressed.values.get('Space')).toBe(1);
    expect(pressed.transitions).toEqual([{ source: 'keyboard', control: 'Space', pressed: true }]);
    target.dispatchEvent(new Event('blur'));
    const released = adapter.sample().find((item) => item.source === 'keyboard')!;
    expect(released.values.get('Space')).toBe(0);
    expect(released.transitions).toEqual([
      { source: 'keyboard', control: 'Space', pressed: false },
    ]);
    adapter.dispose();
  });
});
