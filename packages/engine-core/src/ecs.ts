import { EntityRegistry, type EntityId } from './index.js';

export type ComponentType<T> = Readonly<{ id: symbol; name: string; __component?: T }>;

export function defineComponent<T>(name: string): ComponentType<T> {
  if (!name.trim()) throw new TypeError('Component name must not be empty');
  return Object.freeze({ id: Symbol(name), name });
}

class SparseSet<T> {
  #denseEntities: EntityId[] = [];
  #denseValues: T[] = [];
  #sparse = new Map<EntityId, number>();

  get size(): number {
    return this.#denseEntities.length;
  }
  has(entity: EntityId): boolean {
    return this.#sparse.has(entity);
  }
  get(entity: EntityId): T | undefined {
    const index = this.#sparse.get(entity);
    return index === undefined ? undefined : this.#denseValues[index];
  }
  set(entity: EntityId, value: T): void {
    const index = this.#sparse.get(entity);
    if (index !== undefined) {
      this.#denseValues[index] = value;
      return;
    }
    this.#sparse.set(entity, this.#denseEntities.length);
    this.#denseEntities.push(entity);
    this.#denseValues.push(value);
  }
  delete(entity: EntityId): boolean {
    const index = this.#sparse.get(entity);
    if (index === undefined) return false;
    const last = this.#denseEntities.length - 1;
    if (index !== last) {
      const moved = this.#denseEntities[last]!;
      this.#denseEntities[index] = moved;
      this.#denseValues[index] = this.#denseValues[last]!;
      this.#sparse.set(moved, index);
    }
    this.#denseEntities.pop();
    this.#denseValues.pop();
    this.#sparse.delete(entity);
    return true;
  }
  entities(): readonly EntityId[] {
    return this.#denseEntities;
  }
}

export class World {
  readonly #entities = new EntityRegistry();
  readonly #stores = new Map<symbol, SparseSet<unknown>>();
  #deferred: Array<() => void> = [];

  get entityCount(): number {
    return this.#entities.size;
  }
  createEntity(): EntityId {
    return this.#entities.create();
  }
  isAlive(entity: EntityId): boolean {
    return this.#entities.isAlive(entity);
  }

  destroyEntity(entity: EntityId): boolean {
    if (!this.#entities.destroy(entity)) return false;
    for (const store of this.#stores.values()) store.delete(entity);
    return true;
  }

  add<T>(entity: EntityId, type: ComponentType<T>, value: T): T {
    this.#assertAlive(entity);
    this.#store(type).set(entity, value);
    return value;
  }

  set<T>(entity: EntityId, type: ComponentType<T>, value: T): T {
    return this.add(entity, type, value);
  }

  get<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
    this.#assertAlive(entity);
    return this.#store(type).get(entity) as T | undefined;
  }

  has<T>(entity: EntityId, type: ComponentType<T>): boolean {
    return this.#entities.isAlive(entity) && this.#store(type).has(entity);
  }

  remove<T>(entity: EntityId, type: ComponentType<T>): boolean {
    this.#assertAlive(entity);
    return this.#store(type).delete(entity);
  }

  query(...types: ComponentType<unknown>[]): EntityQuery {
    const stores = types.map((type) => this.#store(type));
    const driver = stores.reduce<SparseSet<unknown> | undefined>(
      (smallest, store) => (!smallest || store.size < smallest.size ? store : smallest),
      undefined,
    );
    return {
      forEach: (visit) => {
        if (!driver) return;
        for (const entity of [...driver.entities()]) {
          if (!this.#entities.isAlive(entity) || !stores.every((store) => store.has(entity)))
            continue;
          visit(entity, ...stores.map((store) => store.get(entity)));
        }
      },
    };
  }

  defer(operation: (world: World) => void): void {
    this.#deferred.push(() => operation(this));
  }

  flushDeferred(): number {
    const pending = this.#deferred;
    this.#deferred = [];
    for (const operation of pending) operation();
    return pending.length;
  }

  #store<T>(type: ComponentType<T>): SparseSet<T> {
    let store = this.#stores.get(type.id);
    if (!store) {
      store = new SparseSet<unknown>();
      this.#stores.set(type.id, store);
    }
    return store as SparseSet<T>;
  }

  #assertAlive(entity: EntityId): void {
    if (!this.#entities.isAlive(entity)) throw new Error(`Entity is not alive: ${entity}`);
  }
}

export interface EntityQuery {
  forEach(visit: (entity: EntityId, ...components: unknown[]) => void): void;
}

export type SystemPhase = 'pre-update' | 'fixed-update' | 'variable-update' | 'post-update';
export interface SystemContext {
  readonly world: World;
  readonly deltaTime: number;
  readonly elapsedTime: number;
}
export interface WorldSystem {
  readonly phase: SystemPhase;
  update(context: SystemContext): void;
}

const PHASE_ORDER: readonly SystemPhase[] = [
  'pre-update',
  'fixed-update',
  'variable-update',
  'post-update',
];
export class SystemScheduler {
  readonly #systems = new Map<SystemPhase, WorldSystem[]>();
  #updating = false;
  add(system: WorldSystem): void {
    if (this.#updating) throw new Error('Cannot register systems during an update');
    const list = this.#systems.get(system.phase) ?? [];
    list.push(system);
    this.#systems.set(system.phase, list);
  }
  update(phase: SystemPhase, context: SystemContext): void {
    if (this.#updating) throw new Error('SystemScheduler does not support nested updates');
    this.#updating = true;
    try {
      for (const system of this.#systems.get(phase) ?? []) system.update(context);
    } finally {
      this.#updating = false;
    }
    context.world.flushDeferred();
  }
  updateFrame(context: SystemContext): void {
    for (const phase of PHASE_ORDER) this.update(phase, context);
  }
}

export type EventHandler<T> = (payload: T) => void;
export class EventBus {
  readonly #listeners = new Map<string, Set<EventHandler<unknown>>>();
  on<T>(event: string, handler: EventHandler<T>): () => void {
    const listeners = this.#listeners.get(event) ?? new Set<EventHandler<unknown>>();
    listeners.add(handler as EventHandler<unknown>);
    this.#listeners.set(event, listeners);
    return () => {
      listeners.delete(handler as EventHandler<unknown>);
      if (!listeners.size) this.#listeners.delete(event);
    };
  }
  emit<T>(event: string, payload: T): void {
    for (const handler of [...(this.#listeners.get(event) ?? [])]) handler(payload);
  }
  clear(): void {
    this.#listeners.clear();
  }
}

export interface ClockOptions {
  readonly fixedDeltaTime?: number;
  readonly maxFrameDelta?: number;
  readonly maxSubSteps?: number;
}
export interface ClockTick {
  readonly deltaTime: number;
  readonly elapsedTime: number;
  readonly fixedSteps: number;
  readonly interpolationAlpha: number;
}
export class EngineClock {
  readonly fixedDeltaTime: number;
  readonly maxFrameDelta: number;
  readonly maxSubSteps: number;
  #elapsed = 0;
  #accumulator = 0;
  constructor(options: ClockOptions = {}) {
    this.fixedDeltaTime = options.fixedDeltaTime ?? 1 / 60;
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    this.maxSubSteps = options.maxSubSteps ?? 5;
    if (
      !(this.fixedDeltaTime > 0) ||
      !(this.maxFrameDelta > 0) ||
      !Number.isInteger(this.maxSubSteps) ||
      this.maxSubSteps < 1
    )
      throw new RangeError('Clock settings must be positive and maxSubSteps must be an integer');
  }
  get elapsedTime(): number {
    return this.#elapsed;
  }
  advance(frameDelta: number): ClockTick {
    if (!Number.isFinite(frameDelta) || frameDelta < 0)
      throw new RangeError('Frame delta must be finite and non-negative');
    const deltaTime = Math.min(frameDelta, this.maxFrameDelta);
    this.#elapsed += deltaTime;
    this.#accumulator += deltaTime;
    const fixedSteps = Math.min(
      Math.floor(this.#accumulator / this.fixedDeltaTime),
      this.maxSubSteps,
    );
    this.#accumulator -= fixedSteps * this.fixedDeltaTime;
    if (fixedSteps === this.maxSubSteps && this.#accumulator >= this.fixedDeltaTime) {
      this.#accumulator %= this.fixedDeltaTime;
      if (this.fixedDeltaTime - this.#accumulator < Number.EPSILON * 16) this.#accumulator = 0;
    }
    return {
      deltaTime,
      elapsedTime: this.#elapsed,
      fixedSteps,
      interpolationAlpha: this.#accumulator / this.fixedDeltaTime,
    };
  }
  reset(): void {
    this.#elapsed = 0;
    this.#accumulator = 0;
  }
}

export type Vec3 = readonly [number, number, number];
export interface TransformData {
  position: Vec3;
  rotation: readonly [number, number, number, number];
  scale: Vec3;
  parent: EntityId | null;
}
export const Transform = defineComponent<TransformData>('Transform');
export function createTransform(): TransformData {
  return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], parent: null };
}

export class TransformHierarchy {
  constructor(readonly world: World) {}
  setParent(child: EntityId, parent: EntityId | null): void {
    const transform = this.world.get(child, Transform);
    if (!transform) throw new Error(`Entity has no Transform: ${child}`);
    if (parent !== null) {
      if (!this.world.isAlive(parent)) throw new Error(`Parent is not alive: ${parent}`);
      if (!this.world.has(parent, Transform)) throw new Error(`Parent has no Transform: ${parent}`);
      if (parent === child || this.isDescendant(parent, child))
        throw new Error('Transform parenting would create a cycle');
    }
    transform.parent = parent;
  }
  isDescendant(entity: EntityId, ancestor: EntityId): boolean {
    let current = this.world.get(entity, Transform)?.parent ?? null;
    const visited = new Set<EntityId>();
    while (current !== null) {
      if (current === ancestor) return true;
      if (visited.has(current)) throw new Error('Existing transform hierarchy contains a cycle');
      visited.add(current);
      current = this.world.get(current, Transform)?.parent ?? null;
    }
    return false;
  }
  children(parent: EntityId): EntityId[] {
    const result: EntityId[] = [];
    this.world.query(Transform).forEach((entity, value) => {
      if ((value as TransformData).parent === parent) result.push(entity);
    });
    return result;
  }

  /** Returns a fresh column-major world matrix; no stale cache can survive direct component edits. */
  worldMatrix(entity: EntityId): Float64Array {
    const visited = new Set<EntityId>();
    const resolve = (current: EntityId): Float64Array => {
      if (visited.has(current)) throw new Error('Transform hierarchy contains a cycle');
      visited.add(current);
      const transform = this.world.get(current, Transform);
      if (!transform) throw new Error(`Entity has no Transform: ${current}`);
      const local = composeTransform(transform);
      return transform.parent === null ? local : multiplyMatrices(resolve(transform.parent), local);
    };
    return resolve(entity);
  }
  detachChildren(parent: EntityId): number {
    const children = this.children(parent);
    for (const child of children) this.world.get(child, Transform)!.parent = null;
    return children.length;
  }
  destroyEntity(
    entity: EntityId,
    policy: 'detach-children' | 'recursive' = 'detach-children',
  ): boolean {
    if (!this.world.isAlive(entity)) return false;
    if (policy === 'recursive') {
      const visit = (current: EntityId): void => {
        for (const child of this.children(current)) visit(child);
        this.world.destroyEntity(current);
      };
      visit(entity);
    } else {
      this.detachChildren(entity);
      this.world.destroyEntity(entity);
    }
    return true;
  }
}

function composeTransform(transform: TransformData): Float64Array {
  const [x, y, z, w] = transform.rotation;
  const [sx, sy, sz] = transform.scale;
  const [tx, ty, tz] = transform.position;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return new Float64Array([
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}

function multiplyMatrices(a: Float64Array, b: Float64Array): Float64Array {
  const result = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      result[column * 4 + row] =
        a[row]! * b[column * 4]! +
        a[4 + row]! * b[column * 4 + 1]! +
        a[8 + row]! * b[column * 4 + 2]! +
        a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return result;
}
