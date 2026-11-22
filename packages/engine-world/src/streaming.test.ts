import { describe, expect, it, vi } from 'vitest';
import { WorldChunkScheduler, WorldStreamingError, type WorldChunkJobResult } from './index.js';

const limits = {
  maxConcurrentJobs: 1,
  maxQueuedJobs: 2,
  maxResidentChunks: 2,
  maxChunkPayloadBytes: 64,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function result(value: string, byteLength = 8): WorldChunkJobResult<string> {
  return { value, byteLength };
}

function request(
  x: number,
  revision: number,
  run: (signal: AbortSignal) => Promise<WorldChunkJobResult<string>> = async () =>
    result(`chunk-${x}`),
  priority = 0,
) {
  return { coordinate: { x, y: 0, z: 0 }, revision, priority, run };
}

function expectStreamingError(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ name: 'WorldStreamingError', code });
}

describe('bounded world chunk scheduler', () => {
  it('validates finite positive resource limits', () => {
    expect(
      () =>
        new WorldChunkScheduler({
          limits: { ...limits, maxConcurrentJobs: 0 },
        }),
    ).toThrow(WorldStreamingError);
  });

  it('deduplicates requests by coordinate and source revision', async () => {
    const gate = deferred<WorldChunkJobResult<string>>();
    const run = vi.fn(() => gate.promise);
    const scheduler = new WorldChunkScheduler<string>({ limits });
    const first = scheduler.request(request(0, 4, run));
    const duplicate = scheduler.request(request(0, 4, run));

    expect(duplicate).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    gate.resolve(result('same-chunk'));
    await expect(first).resolves.toBe('same-chunk');
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })?.revision).toBe(4);
  });

  it('enforces concurrency, queue bounds and stable priority ordering', async () => {
    const firstGate = deferred<WorldChunkJobResult<string>>();
    const started: string[] = [];
    const scheduler = new WorldChunkScheduler<string>({
      limits: { ...limits, maxResidentChunks: 3 },
    });
    const first = scheduler.request(
      request(0, 1, async () => {
        started.push('first');
        return firstGate.promise;
      }),
    );
    const low = scheduler.request(
      request(
        1,
        1,
        async () => {
          started.push('low');
          return result('low');
        },
        1,
      ),
    );
    const high = scheduler.request(
      request(
        2,
        1,
        async () => {
          started.push('high');
          return result('high');
        },
        9,
      ),
    );
    const overflow = scheduler.request(request(3, 1));

    await expectStreamingError(overflow, 'WORLD_QUEUE_FULL');
    expect(scheduler.activeCount).toBe(1);
    expect(scheduler.queuedCount).toBe(2);
    firstGate.resolve(result('first'));
    await Promise.all([first, high, low]);
    expect(started).toEqual(['first', 'high', 'low']);
  });

  it('cancels active work with AbortSignal and rejects its promise', async () => {
    const scheduler = new WorldChunkScheduler<string>({ limits });
    let observedAbort = false;
    const pending = scheduler.request(
      request(
        0,
        1,
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                reject(new Error('worker observed abort'));
              },
              { once: true },
            );
          }),
      ),
    );

    expect(scheduler.cancel({ x: 0, y: 0, z: 0 }, 1)).toBe(true);
    await expectStreamingError(pending, 'WORLD_JOB_CANCELLED');
    await Promise.resolve();
    expect(observedAbort).toBe(true);
    expect(scheduler.residentCount).toBe(0);
  });

  it('hides an older resident while a newer revision is requested', async () => {
    const gate = deferred<WorldChunkJobResult<string>>();
    const scheduler = new WorldChunkScheduler<string>({ limits });
    await scheduler.request(request(0, 1));

    const next = scheduler.request(request(0, 2, () => gate.promise));
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })).toBeUndefined();
    gate.resolve(result('latest'));
    await expect(next).resolves.toBe('latest');
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })?.revision).toBe(2);
  });

  it('rejects stale revision completion instead of publishing it', async () => {
    const oldGate = deferred<WorldChunkJobResult<string>>();
    const scheduler = new WorldChunkScheduler<string>({
      limits: { ...limits, maxConcurrentJobs: 2 },
    });
    const old = scheduler.request(request(0, 1, () => oldGate.promise));
    const current = scheduler.request(request(0, 2, async () => result('new-revision')));

    await expectStreamingError(old, 'WORLD_JOB_CANCELLED');
    oldGate.resolve(result('stale-revision'));
    await expect(current).resolves.toBe('new-revision');
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })?.revision).toBe(2);
    expect(scheduler.getResident({ x: 0, y: 0, z: 0 })?.value).toBe('new-revision');
  });

  it('enforces payload and resident bounds without implicit eviction', async () => {
    const scheduler = new WorldChunkScheduler<string>({
      limits: { ...limits, maxResidentChunks: 1 },
    });
    await expectStreamingError(
      scheduler.request(request(0, 1, async () => result('large', 65))),
      'CHUNK_PAYLOAD_TOO_LARGE',
    );
    await expect(scheduler.request(request(0, 1))).resolves.toBe('chunk-0');
    await expectStreamingError(scheduler.request(request(1, 1)), 'WORLD_RESIDENT_CAPACITY');
    expect(scheduler.residentCount).toBe(1);
  });

  it('evicts explicitly and releases resident values exactly once', async () => {
    const release = vi.fn();
    const scheduler = new WorldChunkScheduler<string>({ limits, releaseResident: release });
    await scheduler.request(request(0, 1));

    expect(scheduler.evict({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(scheduler.evict({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('chunk-0');
    expect(scheduler.residentCount).toBe(0);
  });

  it('survives rapid desired-window churn without publishing stale chunks', async () => {
    const scheduler = new WorldChunkScheduler<string>({
      limits: {
        maxConcurrentJobs: 2,
        maxQueuedJobs: 256,
        maxResidentChunks: 3,
        maxChunkPayloadBytes: 64,
      },
    });
    const promises: Promise<unknown>[] = [];
    let previousWindow = new Set<number>();

    for (let center = 0; center < 100; center += 1) {
      const nextWindow = new Set([center - 1, center, center + 1]);
      for (const x of previousWindow) {
        if (!nextWindow.has(x)) scheduler.evict({ x, y: 0, z: 0 });
      }
      for (const x of nextWindow) {
        promises.push(
          scheduler
            .request({
              coordinate: { x, y: 0, z: 0 },
              revision: 1,
              priority: -Math.abs(x - center),
              run: (signal) =>
                new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => resolve(result(`chunk-${x}`)), 5);
                  signal.addEventListener(
                    'abort',
                    () => {
                      clearTimeout(timeout);
                      reject(new Error('aborted stale chunk job'));
                    },
                    { once: true },
                  );
                }),
            })
            .catch((error: unknown) => {
              if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'WORLD_JOB_CANCELLED'
              ) {
                return undefined;
              }
              throw error;
            }),
        );
      }
      previousWindow = nextWindow;
    }

    await Promise.all(promises);
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.queuedCount).toBe(0);
    expect(scheduler.residentCount).toBe(3);
    expect(
      [-1, 0, 1].map((offset) => scheduler.getResident({ x: 99 + offset, y: 0, z: 0 })?.value),
    ).toEqual(['chunk-98', 'chunk-99', 'chunk-100']);
    scheduler.dispose();
  });

  it('keeps residency bounded across repeated load and explicit eviction cycles', async () => {
    const release = vi.fn();
    const scheduler = new WorldChunkScheduler<string>({
      limits: { ...limits, maxResidentChunks: 1 },
      releaseResident: release,
    });

    for (let cycle = 0; cycle < 40; cycle++) {
      const coordinate = { x: cycle, y: -cycle, z: 0 };
      await scheduler.request({
        coordinate,
        revision: cycle,
        run: async () => result(`cycle-${cycle}`),
      });
      expect(scheduler.residentCount).toBe(1);
      expect(scheduler.evict(coordinate)).toBe(true);
      expect(scheduler.residentCount).toBe(0);
    }

    scheduler.dispose();
    expect(release).toHaveBeenCalledTimes(40);
  });

  it('disposes idempotently, aborts work, releases residents and rejects future requests', async () => {
    const release = vi.fn();
    const scheduler = new WorldChunkScheduler<string>({ limits, releaseResident: release });
    await scheduler.request(request(0, 1));
    const gate = deferred<WorldChunkJobResult<string>>();
    const pending = scheduler.request(request(1, 1, () => gate.promise));

    scheduler.dispose();
    scheduler.dispose();
    await expectStreamingError(pending, 'WORLD_DISPOSED');
    await expectStreamingError(scheduler.request(request(2, 1)), 'WORLD_DISPOSED');
    expect(scheduler.isDisposed).toBe(true);
    expect(scheduler.residentCount).toBe(0);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
