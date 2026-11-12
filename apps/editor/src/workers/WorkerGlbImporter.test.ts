import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerGlbImporter } from './WorkerGlbImporter.js';

type FakeWorkerRequest = { readonly requestId: number };

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static onPostMessage?: (worker: FakeWorker, message: FakeWorkerRequest) => void;
  posted?: { readonly message: FakeWorkerRequest; readonly transfer: Transferable[] };
  terminated = false;

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: FakeWorkerRequest, transfer: Transferable[] = []): void {
    this.posted = { message, transfer };
    FakeWorker.onPostMessage?.(this, message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.onPostMessage = undefined;
});

describe('WorkerGlbImporter', () => {
  it('transfers the source and returns it before resolving the imported asset', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const source = new ArrayBuffer(8);
    const restoredSource = new ArrayBuffer(8);
    const onSourceRestored = vi.fn();
    const result = {
      kind: 'model' as const,
      data: { meshes: [] },
      dependencies: [],
      metadata: {},
    };
    FakeWorker.onPostMessage = (worker, request) => {
      queueMicrotask(() => {
        worker.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'success', requestId: request.requestId, result, source: restoredSource },
          }),
        );
      });
    };

    const promise = new WorkerGlbImporter().import(source, {
      uri: 'imports/ship.glb',
      settings: {},
      signal: new AbortController().signal,
      onSourceRestored,
    });
    const worker = FakeWorker.instances[0]!;

    expect(worker.posted?.transfer).toContain(source);
    await expect(promise).resolves.toBe(result);
    expect(onSourceRestored).toHaveBeenCalledWith(restoredSource);
    expect(worker.terminated).toBe(true);
  });

  it('does not create a worker for an already-aborted signal', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    controller.abort('cancelled before dispatch');

    await expect(
      new WorkerGlbImporter().import(new ArrayBuffer(8), {
        uri: 'imports/ship.glb',
        settings: {},
        signal: controller.signal,
        onSourceRestored: () => {},
      }),
    ).rejects.toThrow('GLB import was aborted');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates the worker and rejects when the import is cancelled', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const pending = new WorkerGlbImporter().import(new ArrayBuffer(8), {
      uri: 'imports/ship.glb',
      settings: {},
      signal: controller.signal,
      onSourceRestored: () => {},
    });
    const worker = FakeWorker.instances[0]!;

    controller.abort('editor unmounted');

    await expect(pending).rejects.toThrow('GLB import was aborted');
    expect(worker.terminated).toBe(true);
  });

  it('preserves importer error name, message, and code', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.onPostMessage = (worker, request) => {
      queueMicrotask(() => {
        worker.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'failure',
              requestId: request.requestId,
              error: { name: 'GlbImportError', message: 'Invalid GLB header', code: 'INVALID_GLB' },
            },
          }),
        );
      });
    };

    await expect(
      new WorkerGlbImporter().import(new ArrayBuffer(8), {
        uri: 'imports/ship.glb',
        settings: {},
        signal: new AbortController().signal,
        onSourceRestored: () => {},
      }),
    ).rejects.toMatchObject({
      name: 'GlbImportError',
      message: 'Invalid GLB header',
      code: 'INVALID_GLB',
    });
  });

  it('rejects unreadable worker messages and terminates the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = new WorkerGlbImporter().import(new ArrayBuffer(8), {
      uri: 'imports/ship.glb',
      settings: {},
      signal: new AbortController().signal,
      onSourceRestored: () => {},
    });
    const worker = FakeWorker.instances[0]!;
    worker.dispatchEvent(new Event('messageerror'));

    await expect(pending).rejects.toThrow('unreadable message');
    expect(worker.terminated).toBe(true);
  });

  it('requires a source-restoration callback so transferred input is not lost', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    await expect(
      new WorkerGlbImporter().import(new ArrayBuffer(8), {
        uri: 'imports/ship.glb',
        settings: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('source-restoration callback');
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
