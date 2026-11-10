import { describe, expect, it, vi } from 'vitest';
import {
  EngineClock,
  EngineRuntime,
  EventBus,
  defineComponent,
  SystemScheduler,
  Transform,
  TransformHierarchy,
  TransformPropagationSystem,
  World,
  type SystemContext,
} from './ecs.js';

describe('World and sparse component storage', () => {
  const Position = defineComponent<{ x: number }>('Position');
  const Velocity = defineComponent<{ x: number }>('Velocity');
  it('creates entities, stores components and rejects stale entity handles', () => {
    const world = new World();
    const entity = world.createEntity();
    world.add(entity, Position, { x: 4 });
    expect(world.get(entity, Position)?.x).toBe(4);
    expect(world.destroyEntity(entity)).toBe(true);
    expect(world.isAlive(entity)).toBe(false);
    expect(() => world.add(entity, Position, { x: 5 })).toThrow('not alive');
  });
  it('keeps sparse-set membership correct after swap removal', () => {
    const world = new World();
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();
    world.add(a, Position, { x: 1 });
    world.add(b, Position, { x: 2 });
    world.add(c, Position, { x: 3 });
    world.remove(b, Position);
    const found: number[] = [];
    world.query(Position).forEach((_entity, position) => found.push((position as { x: number }).x));
    expect(found.sort()).toEqual([1, 3]);
  });
  it('queries intersection of component types', () => {
    const world = new World();
    const a = world.createEntity();
    const b = world.createEntity();
    world.add(a, Position, { x: 1 });
    world.add(a, Velocity, { x: 2 });
    world.add(b, Position, { x: 3 });
    const found: string[] = [];
    world.query(Position, Velocity).forEach((entity) => found.push(entity));
    expect(found).toEqual([a]);
  });
  it('defers structural changes until flush', () => {
    const world = new World();
    const entity = world.createEntity();
    world.defer((target) => target.add(entity, Position, { x: 9 }));
    expect(world.has(entity, Position)).toBe(false);
    expect(world.flushDeferred()).toBe(1);
    expect(world.get(entity, Position)?.x).toBe(9);
  });
});

describe('system scheduler, events and clock', () => {
  it('runs systems in registration order and flushes deferred changes', () => {
    const world = new World();
    const entity = world.createEntity();
    const calls: string[] = [];
    const context: SystemContext = { world, deltaTime: 1 / 60, elapsedTime: 1 / 60 };
    const scheduler = new SystemScheduler();
    scheduler.add({ phase: 'pre-update', update: () => calls.push('first') });
    scheduler.add({
      phase: 'pre-update',
      update: ({ world: w }) => {
        calls.push('second');
        w.defer((target) => target.destroyEntity(entity));
      },
    });
    scheduler.update('pre-update', context);
    expect(calls).toEqual(['first', 'second']);
    expect(world.isAlive(entity)).toBe(false);
  });
  it('snapshots event listeners and supports unsubscribe', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsubscribe = bus.on('ready', listener);
    bus.emit('ready', { value: 1 });
    unsubscribe();
    bus.emit('ready', { value: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('advances a capped fixed-step clock', () => {
    const clock = new EngineClock({ fixedDeltaTime: 0.1, maxFrameDelta: 0.5, maxSubSteps: 3 });
    const tick = clock.advance(0.5);
    expect(tick.deltaTime).toBe(0.5);
    expect(tick.fixedSteps).toBe(3);
    expect(tick.interpolationAlpha).toBeCloseTo(0);
  });
});

describe('EngineRuntime', () => {
  it('runs fixed steps before variable/post phases and propagates transforms last', () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 0.1, maxFrameDelta: 0.5, maxSubSteps: 4 });
    const parent = runtime.world.createEntity();
    const child = runtime.world.createEntity();
    runtime.world.add(parent, Transform, {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    runtime.world.add(child, Transform, {
      position: [2, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    runtime.hierarchy.setParent(child, parent);

    const phases: string[] = [];
    const fixedTimes: Array<[number, number]> = [];
    runtime.scheduler.add({ phase: 'pre-update', update: () => phases.push('pre') });
    runtime.scheduler.add({
      phase: 'fixed-update',
      update: ({ world, deltaTime, elapsedTime }) => {
        phases.push('fixed');
        fixedTimes.push([deltaTime, elapsedTime]);
        world.get(parent, Transform)!.position = [
          world.get(parent, Transform)!.position[0] + 1,
          0,
          0,
        ];
      },
    });
    runtime.scheduler.add({ phase: 'variable-update', update: () => phases.push('variable') });
    runtime.scheduler.add({ phase: 'post-update', update: () => phases.push('post') });

    const frames: number[] = [];
    runtime.events.on('runtime:frame', (tick: { fixedSteps: number }) =>
      frames.push(tick.fixedSteps),
    );
    const tick = runtime.advance(0.25);

    expect(tick.fixedSteps).toBe(2);
    expect(phases).toEqual(['pre', 'fixed', 'fixed', 'variable', 'post']);
    expect(fixedTimes[0]?.[0]).toBeCloseTo(0.1);
    expect(fixedTimes[0]?.[1]).toBeCloseTo(0.1);
    expect(fixedTimes[1]?.[1]).toBeCloseTo(0.2);
    expect(Array.from(runtime.hierarchy.getWorldMatrix(child)!.slice(12, 15))).toEqual([4, 0, 0]);
    expect(frames).toEqual([2]);
  });

  it('skips fixed systems when no fixed step is due but still propagates after the frame', () => {
    const runtime = new EngineRuntime({ fixedDeltaTime: 0.1 });
    const entity = runtime.world.createEntity();
    runtime.world.add(entity, Transform, {
      position: [3, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    const fixed = vi.fn();
    runtime.scheduler.add({ phase: 'fixed-update', update: fixed });
    runtime.advance(0.02);
    expect(fixed).not.toHaveBeenCalled();
    expect(runtime.hierarchy.getWorldMatrix(entity)?.[12]).toBe(3);
  });
});

describe('transform hierarchy', () => {
  it('validates parents, detects cycles and handles child deletion policies', () => {
    const world = new World();
    const hierarchy = new TransformHierarchy(world);
    const root = world.createEntity();
    const child = world.createEntity();
    const grandchild = world.createEntity();
    for (const entity of [root, child, grandchild])
      world.add(entity, Transform, {
        ...({
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          parent: null,
        } as const),
      });
    hierarchy.setParent(child, root);
    hierarchy.setParent(grandchild, child);
    expect(() => hierarchy.setParent(root, grandchild)).toThrow('cycle');
    expect(hierarchy.children(root)).toEqual([child]);
    hierarchy.destroyEntity(child, 'detach-children');
    expect(world.get(grandchild, Transform)?.parent).toBeNull();
    expect(world.isAlive(child)).toBe(false);
  });
  it('composes local transforms into a column-major world matrix', () => {
    const world = new World();
    const hierarchy = new TransformHierarchy(world);
    const parent = world.createEntity();
    const child = world.createEntity();
    world.add(parent, Transform, {
      position: [10, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [2, 2, 2],
      parent: null,
    });
    world.add(child, Transform, {
      position: [1, 3, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    hierarchy.setParent(child, parent);
    const matrix = hierarchy.worldMatrix(child);
    expect(Array.from(matrix.slice(12, 15))).toEqual([12, 6, 0]);
    expect(Array.from(matrix.slice(0, 3))).toEqual([2, 0, 0]);
  });

  it('propagates parent and child transforms in the scheduler final phase', () => {
    const world = new World();
    const hierarchy = new TransformHierarchy(world);
    const parent = world.createEntity();
    const child = world.createEntity();
    world.add(parent, Transform, {
      position: [5, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    world.add(child, Transform, {
      position: [2, 3, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    hierarchy.setParent(child, parent);

    const scheduler = new SystemScheduler();
    scheduler.add({
      phase: 'post-update',
      update: () => {
        world.get(parent, Transform)!.position = [8, 0, 0];
      },
    });
    scheduler.add(new TransformPropagationSystem(hierarchy));
    scheduler.updateFrame({
      world,
      deltaTime: 1 / 60,
      elapsedTime: 1 / 60,
    });

    expect(Array.from(hierarchy.getWorldMatrix(child)!.slice(12, 15))).toEqual([10, 3, 0]);
    const snapshot = hierarchy.getWorldMatrix(child)!;
    snapshot[12] = 999;
    expect(hierarchy.getWorldMatrix(child)![12]).toBe(10);

    world.get(parent, Transform)!.position = [11, 0, 0];
    hierarchy.propagate();
    expect(Array.from(hierarchy.getWorldMatrix(child)!.slice(12, 15))).toEqual([13, 3, 0]);
  });

  it('recursively destroys descendants', () => {
    const world = new World();
    const hierarchy = new TransformHierarchy(world);
    const root = world.createEntity();
    const child = world.createEntity();
    world.add(root, Transform, {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    world.add(child, Transform, {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      parent: null,
    });
    hierarchy.setParent(child, root);
    hierarchy.destroyEntity(root, 'recursive');
    expect(world.entityCount).toBe(0);
  });
});
