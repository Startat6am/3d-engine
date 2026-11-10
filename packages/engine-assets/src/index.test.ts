import { describe, expect, it } from 'vitest';
import { AssetRegistry, AssetRegistryError, normalizeAssetUri, type AssetId } from './index.js';

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
    expect(() => registry.register(input({ id: 'asset:other' as AssetId, dependencies: ['asset:missing' as AssetId] }))).toThrow('Missing asset dependency');
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
    expect(() => registry.register(input({ id: first.id, dependencies: ['asset:second' as AssetId] }))).toThrow('already registered');
  });
});
