import { describe, expect, it, vi } from 'vitest';
import {
  AssetImportError,
  AssetImportService,
  AssetResourceCache,
  AssetRegistry,
  AssetRegistryError,
  normalizeAssetUri,
  type AssetId,
} from './index.js';

const input = (overrides: Partial<Parameters<AssetRegistry['register']>[0]> = {}) => ({
  name: 'Mesh',
  kind: 'mesh' as const,
  uri: 'models/mesh.bin',
  contentHash: 'sha256:abc',
  importer: { id: 'engine.mesh', version: '1.0.0', settings: {} },
  metadata: {},
  ...overrides,
});

describe('AssetRegistry', () => {
  it('normalizes project-relative URIs', () => {
    expect(normalizeAssetUri('models/ship.glb')).toBe('models/ship.glb');
    expect(() => normalizeAssetUri('../outside.glb')).toThrow(AssetRegistryError);
    expect(() => normalizeAssetUri('https://example.com/model.glb')).toThrow(AssetRegistryError);
    expect(() => normalizeAssetUri('/absolute/model.glb')).toThrow(AssetRegistryError);
  });

  it('registers, queries, filters and removes assets', () => {
    const registry = new AssetRegistry();
    const asset = registry.register(input());
    expect(registry.require(asset.id)).toBe(asset);
    expect(registry.list('mesh')).toHaveLength(1);
    expect(registry.remove(asset.id)).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('rejects duplicate identities and missing dependencies', () => {
    const registry = new AssetRegistry();
    const asset = registry.register(input({ id: 'asset:mesh' as AssetId }));
    expect(() => registry.register(input({ id: asset.id }))).toThrow('already registered');
    expect(() =>
      registry.register(
        input({ id: 'asset:other' as AssetId, dependencies: ['asset:missing' as AssetId] }),
      ),
    ).toThrow('Missing asset dependency');
  });

  it('prevents removal while referenced', () => {
    const registry = new AssetRegistry();
    const source = registry.register(input({ id: 'asset:source' as AssetId }));
    registry.register(input({ id: 'asset:derived' as AssetId, dependencies: [source.id] }));
    expect(() => registry.remove(source.id)).toThrow('still referenced');
  });

  it('does not allow re-registering an identity to introduce a dependency cycle', () => {
    const registry = new AssetRegistry();
    const first = registry.register(input({ id: 'asset:first' as AssetId }));
    registry.register(input({ id: 'asset:second' as AssetId, dependencies: [first.id] }));
    expect(() =>
      registry.register(input({ id: first.id, dependencies: ['asset:second' as AssetId] })),
    ).toThrow('already registered');
  });
});

describe('AssetImportService', () => {
  it('dispatches by normalized extension and passes source context', async () => {
    const service = new AssetImportService();
    let receivedUri = '';
    service.register({
      id: 'test.glb',
      version: '1.0.0',
      extensions: ['.GLB'],
      async import(_source, context) {
        receivedUri = context.uri;
        return { kind: 'model', data: { meshes: 1 }, dependencies: [], metadata: {} };
      },
    });
    const result = await service.import<{ meshes: number }>('models/ship.GLB', new ArrayBuffer(8));
    expect(receivedUri).toBe('models/ship.GLB');
    expect(result.data.meshes).toBe(1);
  });

  it('rejects extension collisions and unsupported formats', async () => {
    const service = new AssetImportService();
    const importer = {
      id: 'test.glb',
      version: '1.0.0',
      extensions: ['glb'],
      async import() {
        return { kind: 'model' as const, data: null, dependencies: [], metadata: {} };
      },
    };
    service.register(importer);
    expect(() => service.register({ ...importer, id: 'other.glb' })).toThrow(AssetImportError);
    await expect(service.import('models/ship.obj', new ArrayBuffer(0))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('rejects work already cancelled before importer invocation', async () => {
    const service = new AssetImportService();
    let called = false;
    service.register({
      id: 'test.glb',
      version: '1.0.0',
      extensions: ['glb'],
      async import() {
        called = true;
        return { kind: 'model', data: null, dependencies: [], metadata: {} };
      },
    });
    const controller = new AbortController();
    controller.abort('cancelled');
    await expect(
      service.import('ship.glb', new ArrayBuffer(0), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(called).toBe(false);
  });

  it('passes cancellation to importer and rejects an aborted result', async () => {
    const service = new AssetImportService();
    const controller = new AbortController();
    service.register({
      id: 'test.glb',
      version: '1.0.0',
      extensions: ['glb'],
      async import(_source, context) {
        expect(context.signal).toBe(controller.signal);
        controller.abort('cancelled during decode');
        return { kind: 'model', data: null, dependencies: [], metadata: {} };
      },
    });
    await expect(
      service.import('ship.glb', new ArrayBuffer(0), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('AssetResourceCache', () => {
  it('deduplicates concurrent loads and disposes after the final lease', async () => {
    const cache = new AssetResourceCache<{ id: number }>();
    const load = vi.fn(async () => ({ id: 7 }));
    const dispose = vi.fn();
    const [first, second] = await Promise.all([
      cache.acquire('asset:model', load, dispose),
      cache.acquire('asset:model', load, dispose),
    ]);

    expect(load).toHaveBeenCalledOnce();
    expect(first.resource).toBe(second.resource);
    expect(cache.referenceCount('asset:model')).toBe(2);
    first.release();
    first.release();
    expect(dispose).not.toHaveBeenCalled();
    second.release();
    expect(dispose).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });

  it('shares synchronous resources and disposes only after the final lease', () => {
    const cache = new AssetResourceCache<{ id: number }>();
    const load = vi.fn(() => ({ id: 11 }));
    const dispose = vi.fn();
    const first = cache.acquireSync('gpu:geometry', load, dispose);
    const second = cache.acquireSync('gpu:geometry', load, dispose);
    expect(load).toHaveBeenCalledOnce();
    expect(first.resource).toBe(second.resource);
    first.release();
    expect(dispose).not.toHaveBeenCalled();
    second.release();
    expect(dispose).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });

  it('rejects a synchronous acquire while the same key is loading asynchronously', async () => {
    const cache = new AssetResourceCache<number>();
    let resolve!: (value: number) => void;
    const pending = cache.acquire(
      'mixed:key',
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
      () => {},
    );
    await Promise.resolve();
    expect(() =>
      cache.acquireSync(
        'mixed:key',
        () => 2,
        () => {},
      ),
    ).toThrow('already loading');
    resolve(1);
    const lease = await pending;
    lease.release();
  });

  it('removes failed loads so a later acquire can retry', async () => {
    const cache = new AssetResourceCache<number>();
    await expect(
      cache.acquire(
        'asset:retry',
        async () => {
          throw new Error('decode failed');
        },
        () => {},
      ),
    ).rejects.toThrow('decode failed');
    const lease = await cache.acquire(
      'asset:retry',
      () => 42,
      () => {},
    );
    expect(lease.resource).toBe(42);
    lease.release();
    expect(cache.size).toBe(0);
  });
});
