import { chunkCoordinateKey, createChunkCoordinate, type ChunkCoordinate3 } from './index.js';

export interface WorldStreamingLimits {
  readonly maxConcurrentJobs: number;
  readonly maxQueuedJobs: number;
  readonly maxResidentChunks: number;
  readonly maxChunkPayloadBytes: number;
}

export interface WorldChunkJobResult<T> {
  readonly value: T;
  readonly byteLength: number;
}

export interface WorldChunkJobRequest<T> {
  readonly coordinate: ChunkCoordinate3;
  readonly revision: number;
  readonly priority?: number;
  readonly run: (signal: AbortSignal) => Promise<WorldChunkJobResult<T>>;
}

export interface WorldChunkResident<T> {
  readonly coordinate: ChunkCoordinate3;
  readonly revision: number;
  readonly value: T;
  readonly byteLength: number;
}

export interface WorldChunkSchedulerOptions<T> {
  readonly limits: WorldStreamingLimits;
  readonly releaseResident?: (value: T) => void;
}

export type WorldStreamingErrorCode =
  | 'INVALID_STREAMING_LIMIT'
  | 'INVALID_CHUNK_REVISION'
  | 'INVALID_JOB_PRIORITY'
  | 'INVALID_CHUNK_PAYLOAD_SIZE'
  | 'CHUNK_PAYLOAD_TOO_LARGE'
  | 'WORLD_QUEUE_FULL'
  | 'WORLD_RESIDENT_CAPACITY'
  | 'WORLD_JOB_CANCELLED'
  | 'WORLD_DISPOSED';

export class WorldStreamingError extends Error {
  constructor(
    readonly code: WorldStreamingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldStreamingError';
  }
}

interface ChunkJob<T> {
  readonly key: string;
  readonly coordinateKey: string;
  readonly coordinate: ChunkCoordinate3;
  readonly revision: number;
  readonly priority: number;
  readonly sequence: number;
  readonly generation: number;
  readonly run: WorldChunkJobRequest<T>['run'];
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  settled: boolean;
}

function validateLimits(limits: WorldStreamingLimits): WorldStreamingLimits {
  const values = [
    limits.maxConcurrentJobs,
    limits.maxQueuedJobs,
    limits.maxResidentChunks,
    limits.maxChunkPayloadBytes,
  ];
  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new WorldStreamingError(
      'INVALID_STREAMING_LIMIT',
      'World streaming limits must be positive safe integers',
    );
  }
  return Object.freeze({ ...limits });
}

/** Bounded, main-thread chunk job scheduler with explicit residency ownership. */
export class WorldChunkScheduler<T> {
  readonly #limits: WorldStreamingLimits;
  readonly #releaseResident: ((value: T) => void) | undefined;
  readonly #queue: ChunkJob<T>[] = [];
  readonly #jobs = new Map<string, ChunkJob<T>>();
  readonly #active = new Set<ChunkJob<T>>();
  readonly #residents = new Map<string, WorldChunkResident<T>>();
  readonly #desiredRevisions = new Map<string, number>();
  #sequence = 0;
  #generation = 0;
  #disposed = false;

  constructor(options: WorldChunkSchedulerOptions<T>) {
    this.#limits = validateLimits(options.limits);
    this.#releaseResident = options.releaseResident;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  get queuedCount(): number {
    return this.#queue.length;
  }

  get residentCount(): number {
    return this.#residents.size;
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  request(request: WorldChunkJobRequest<T>): Promise<T> {
    if (this.#disposed) {
      return Promise.reject(
        new WorldStreamingError('WORLD_DISPOSED', 'Cannot request a chunk from a disposed world'),
      );
    }
    if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
      return Promise.reject(
        new WorldStreamingError(
          'INVALID_CHUNK_REVISION',
          'Chunk job revision must be a non-negative safe integer',
        ),
      );
    }
    const priority = request.priority ?? 0;
    if (!Number.isFinite(priority)) {
      return Promise.reject(
        new WorldStreamingError('INVALID_JOB_PRIORITY', 'Chunk job priority must be finite'),
      );
    }

    let coordinate: ChunkCoordinate3;
    try {
      coordinate = createChunkCoordinate(request.coordinate);
    } catch (error) {
      return Promise.reject(error);
    }

    const coordinateKey = chunkCoordinateKey(coordinate);
    const key = `${coordinateKey}@${request.revision}`;
    const existingJob = this.#jobs.get(key);
    if (existingJob) return existingJob.promise;

    this.#desiredRevisions.set(coordinateKey, request.revision);
    this.#cancelOtherRevisions(coordinateKey, request.revision);

    const resident = this.#residents.get(coordinateKey);
    if (resident?.revision === request.revision) {
      return Promise.resolve(resident.value);
    }

    if (
      this.#active.size >= this.#limits.maxConcurrentJobs &&
      this.#queue.length >= this.#limits.maxQueuedJobs
    ) {
      return Promise.reject(
        new WorldStreamingError('WORLD_QUEUE_FULL', 'World chunk request queue is full'),
      );
    }

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const job: ChunkJob<T> = {
      key,
      coordinateKey,
      coordinate,
      revision: request.revision,
      priority,
      sequence: this.#sequence++,
      generation: this.#generation,
      run: request.run,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      settled: false,
    };

    this.#jobs.set(key, job);
    this.#queue.push(job);
    this.#queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
    this.#pump();
    return promise;
  }

  /** Cancel queued or active work for a coordinate, optionally limited to one revision. */
  cancel(coordinate: ChunkCoordinate3, revision?: number): boolean {
    if (this.#disposed) return false;
    const coordinateKey = chunkCoordinateKey(createChunkCoordinate(coordinate));
    const matching = [...this.#jobs.values()].filter(
      (job) => job.coordinateKey === coordinateKey && (revision === undefined || job.revision === revision),
    );
    for (const job of matching) this.#cancelJob(job, 'WORLD_JOB_CANCELLED');
    if (revision === undefined || this.#desiredRevisions.get(coordinateKey) === revision) {
      this.#desiredRevisions.delete(coordinateKey);
    }
    return matching.length > 0;
  }

  /** Explicitly cancel work and release a resident chunk. Safe to call repeatedly. */
  evict(coordinate: ChunkCoordinate3): boolean {
    const coordinateKey = chunkCoordinateKey(createChunkCoordinate(coordinate));
    const hadResident = this.#removeResident(coordinateKey);
    const hadJobs = this.cancel(coordinate);
    this.#desiredRevisions.delete(coordinateKey);
    return hadResident || hadJobs;
  }

  getResident(coordinate: ChunkCoordinate3): WorldChunkResident<T> | undefined {
    const coordinateKey = chunkCoordinateKey(createChunkCoordinate(coordinate));
    const resident = this.#residents.get(coordinateKey);
    if (!resident) return undefined;
    const desiredRevision = this.#desiredRevisions.get(coordinateKey);
    return desiredRevision === undefined || desiredRevision === resident.revision ? resident : undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation++;
    for (const job of [...this.#jobs.values()]) this.#cancelJob(job, 'WORLD_DISPOSED');
    this.#queue.length = 0;
    this.#desiredRevisions.clear();
    for (const coordinateKey of this.#residents.keys()) this.#removeResident(coordinateKey);
  }

  #cancelOtherRevisions(coordinateKey: string, revision: number): void {
    for (const job of [...this.#jobs.values()]) {
      if (job.coordinateKey === coordinateKey && job.revision !== revision) {
        this.#cancelJob(job, 'WORLD_JOB_CANCELLED');
      }
    }
  }

  #cancelJob(job: ChunkJob<T>, code: 'WORLD_JOB_CANCELLED' | 'WORLD_DISPOSED'): void {
    if (job.settled) return;
    const queueIndex = this.#queue.indexOf(job);
    if (queueIndex >= 0) this.#queue.splice(queueIndex, 1);
    job.controller.abort();
    job.settled = true;
    if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
    const message =
      code === 'WORLD_DISPOSED'
        ? 'World was disposed before the chunk job completed'
        : 'Chunk job was cancelled';
    job.reject(new WorldStreamingError(code, message));
    if (queueIndex >= 0) this.#pump();
  }

  #removeResident(coordinateKey: string): boolean {
    const resident = this.#residents.get(coordinateKey);
    if (!resident) return false;
    this.#residents.delete(coordinateKey);
    this.#releaseResident?.(resident.value);
    return true;
  }

  #pump(): void {
    while (!this.#disposed && this.#active.size < this.#limits.maxConcurrentJobs && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      if (job.settled) continue;
      this.#active.add(job);
      void this.#runJob(job);
    }
  }

  async #runJob(job: ChunkJob<T>): Promise<void> {
    try {
      const result = await job.run(job.controller.signal);
      if (job.settled) return;
      if (
        this.#disposed ||
        job.generation !== this.#generation ||
        job.controller.signal.aborted ||
        this.#desiredRevisions.get(job.coordinateKey) !== job.revision
      ) {
        throw new WorldStreamingError('WORLD_JOB_CANCELLED', 'Chunk job result became stale before publication');
      }
      if (!Number.isSafeInteger(result.byteLength) || result.byteLength < 0) {
        throw new WorldStreamingError(
          'INVALID_CHUNK_PAYLOAD_SIZE',
          'Chunk payload byte length must be a non-negative safe integer',
        );
      }
      if (result.byteLength > this.#limits.maxChunkPayloadBytes) {
        throw new WorldStreamingError(
          'CHUNK_PAYLOAD_TOO_LARGE',
          `Chunk payload exceeds the ${this.#limits.maxChunkPayloadBytes}-byte limit`,
        );
      }
      const previous = this.#residents.get(job.coordinateKey);
      if (!previous && this.#residents.size >= this.#limits.maxResidentChunks) {
        throw new WorldStreamingError(
          'WORLD_RESIDENT_CAPACITY',
          'Resident chunk capacity reached; explicitly evict a chunk before publishing another',
        );
      }
      if (previous) this.#removeResident(job.coordinateKey);
      this.#residents.set(
        job.coordinateKey,
        Object.freeze({
          coordinate: job.coordinate,
          revision: job.revision,
          value: result.value,
          byteLength: result.byteLength,
        }),
      );
      job.settled = true;
      job.resolve(result.value);
    } catch (error) {
      if (!job.settled) {
        job.settled = true;
        job.reject(error);
      }
    } finally {
      this.#active.delete(job);
      if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
      this.#pump();
    }
  }
}
