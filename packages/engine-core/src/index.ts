export type EngineState = 'idle' | 'starting' | 'running' | 'stopping' | 'disposed';

export interface EngineCapabilities {
  readonly rendererBackends: readonly string[];
  readonly supportsWebGL2: boolean;
  readonly supportsWebGPU: boolean;
}

export interface EngineStartOptions {
  readonly signal?: AbortSignal;
}

export interface EngineService {
  start?(options?: EngineStartOptions): void | Promise<void>;
  stop?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export class EngineLifecycleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EngineLifecycleError';
  }
}

/** Owns service startup/shutdown order and guarantees reverse-order cleanup. */
export class EngineHost {
  readonly capabilities: EngineCapabilities;
  #services: EngineService[] = [];
  #state: EngineState = 'idle';

  constructor(
    capabilities: EngineCapabilities = {
      rendererBackends: [],
      supportsWebGL2: false,
      supportsWebGPU: false,
    },
  ) {
    this.capabilities = capabilities;
  }

  get state(): EngineState {
    return this.#state;
  }

  register(service: EngineService): void {
    if (this.#state !== 'idle')
      throw new EngineLifecycleError('Services can only be registered before start');
    this.#services.push(service);
  }

  async start(options: EngineStartOptions = {}): Promise<void> {
    if (this.#state !== 'idle')
      throw new EngineLifecycleError(`Cannot start engine from ${this.#state}`);
    this.#state = 'starting';
    const started: EngineService[] = [];
    try {
      for (const service of this.#services) {
        if (options.signal?.aborted)
          throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
        await service.start?.(options);
        started.push(service);
      }
      this.#state = 'running';
    } catch (cause) {
      const rollbackErrors: unknown[] = [];
      for (const service of started.reverse()) {
        try {
          await service.stop?.();
        } catch (error) {
          rollbackErrors.push(error);
        }
      }
      this.#state = 'idle';
      const failure = rollbackErrors.length
        ? new AggregateError([cause, ...rollbackErrors], 'Startup and rollback both failed')
        : cause;
      throw new EngineLifecycleError(
        'Engine startup failed; initialized services were rolled back',
        {
          cause: failure,
        },
      );
    }
  }

  async stop(): Promise<void> {
    if (this.#state === 'idle') return;
    if (this.#state === 'disposed')
      throw new EngineLifecycleError('Disposed engine cannot be stopped');
    if (this.#state !== 'running')
      throw new EngineLifecycleError(`Cannot stop engine from ${this.#state}`);
    this.#state = 'stopping';
    const errors: unknown[] = [];
    for (const service of [...this.#services].reverse()) {
      try {
        await service.stop?.();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#state = 'idle';
    if (errors.length)
      throw new AggregateError(errors, 'One or more engine services failed to stop');
  }

  async dispose(): Promise<void> {
    if (this.#state === 'disposed') return;
    if (this.#state === 'running') await this.stop();
    if (this.#state !== 'idle')
      throw new EngineLifecycleError(`Cannot dispose engine from ${this.#state}`);
    const errors: unknown[] = [];
    for (const service of [...this.#services].reverse()) {
      try {
        await service.dispose?.();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#services = [];
    this.#state = 'disposed';
    if (errors.length)
      throw new AggregateError(errors, 'One or more engine services failed to dispose');
  }
}

export type EntityId = string & { readonly __entityId: unique symbol };

/** String handles keep generation counters monotonic and cannot alias after a fixed-width wrap. */
export class EntityRegistry {
  #generations: number[] = [];
  #alive: boolean[] = [];
  #free: number[] = [];

  create(): EntityId {
    const index = this.#free.pop() ?? this.#generations.length;
    if (this.#generations[index] === undefined) this.#generations[index] = 0;
    this.#alive[index] = true;
    return `${index}:${this.#generations[index]}` as EntityId;
  }

  destroy(id: EntityId): boolean {
    const parsed = this.#parse(id);
    if (
      !parsed ||
      !this.#alive[parsed.index] ||
      this.#generations[parsed.index] !== parsed.generation
    )
      return false;
    this.#alive[parsed.index] = false;
    this.#generations[parsed.index] = parsed.generation + 1;
    this.#free.push(parsed.index);
    return true;
  }

  isAlive(id: EntityId): boolean {
    const parsed = this.#parse(id);
    return (
      parsed !== null &&
      this.#alive[parsed.index] === true &&
      this.#generations[parsed.index] === parsed.generation
    );
  }

  get size(): number {
    return this.#alive.reduce((count, alive) => count + Number(alive), 0);
  }

  #parse(id: EntityId): { index: number; generation: number } | null {
    const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(id);
    if (!match) return null;
    const index = Number(match[1]);
    const generation = Number(match[2]);
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(generation)) return null;
    return { index, generation };
  }
}
