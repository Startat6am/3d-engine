import goldenFixture from '../fixtures/world-v1-assets.world.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import {
  CURRENT_WORLD_SCHEMA_VERSION,
  WorldMigrationRegistry,
  WorldSerializationError,
  parseWorld,
  serializeWorld,
  validateWorldDocument,
  type WorldDocument,
} from './index.js';

const asset = (id: string, dependencies: string[] = []) => ({ id, dependencies });

const world = (): WorldDocument => ({
  format: 'universal-3d-world',
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  engineVersion: '0.1.0',
  world: { id: 'world:test', name: 'Test', settings: {}, entities: [] },
  assets: [],
  extensions: {},
});

describe('world serialization', () => {
  it('keeps the versioned asset world golden fixture byte-stable', () => {
    const fixture = JSON.stringify(goldenFixture, null, 2);
    const parsed = parseWorld(fixture);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assetPayloads?.[0]?.assetId).toBe('asset:model:triangle');
    expect(serializeWorld(parsed)).toBe(fixture);
  });

  it('round-trips a valid document with deterministic key ordering', () => {
    const source = serializeWorld(world());
    expect(parseWorld(source)).toEqual(world());
    expect(serializeWorld(parseWorld(source))).toBe(source);
  });

  it('round-trips embedded source asset payloads and rejects duplicate payload IDs', () => {
    const document: WorldDocument = {
      ...world(),
      assets: [asset('asset:model')],
      assetPayloads: [
        {
          assetId: 'asset:model',
          mimeType: 'model/gltf-binary',
          encoding: 'base64',
          data: 'Z2xiYg==',
        },
      ],
    };
    expect(parseWorld(serializeWorld(document))).toEqual(document);
    expect(() =>
      validateWorldDocument({
        ...document,
        assetPayloads: [...document.assetPayloads!, ...document.assetPayloads!],
      }),
    ).toThrow('Duplicate asset payload ID');
  });

  it('rejects entity and embedded payload references to missing assets', () => {
    expect(() =>
      validateWorldDocument({
        ...world(),
        world: {
          ...world().world,
          entities: [
            { id: 'entity:missing', components: { MeshRenderer: { assetId: 'asset:missing' } } },
          ],
        },
      }),
    ).toThrow('Entity references an unknown asset');

    expect(() =>
      validateWorldDocument({
        ...world(),
        assetPayloads: [
          {
            assetId: 'asset:missing',
            mimeType: 'model/gltf-binary',
            encoding: 'base64',
            data: 'AA==',
          },
        ],
      }),
    ).toThrow('Embedded payload references an unknown asset');
  });

  it('rejects duplicate assets, missing dependencies and dependency cycles', () => {
    expect(() =>
      validateWorldDocument({ ...world(), assets: [asset('asset:a'), asset('asset:a')] }),
    ).toThrow('Duplicate asset ID');
    expect(() =>
      validateWorldDocument({ ...world(), assets: [asset('asset:a', ['asset:missing'])] }),
    ).toThrow('Asset dependency does not exist');
    expect(() =>
      validateWorldDocument({
        ...world(),
        assets: [asset('asset:a', ['asset:b']), asset('asset:b', ['asset:a'])],
      }),
    ).toThrow('Asset dependency cycle detected');
  });

  it('ships the JSON Schema beside the compiled package entry point', async () => {
    const schemaUrl = new URL('./schemas/world-v1.schema.json', import.meta.url);
    const schema = await import(schemaUrl.href, { with: { type: 'json' } });
    expect(schema.default.$id).toBe('https://choreon.dev/schemas/world-v1.schema.json');
  });

  it('validates nested document structure against the published v1 JSON Schema', () => {
    expect(() =>
      validateWorldDocument({
        ...world(),
        world: { ...world().world, entities: [{ id: 'entity:bad', components: [] }] },
      }),
    ).toThrow('Schema validation failed');
  });

  it('rejects materials that reference a missing base color texture asset', () => {
    expect(() =>
      validateWorldDocument({
        ...world(),
        world: {
          ...world().world,
          entities: [
            {
              id: 'entity:mesh',
              components: {
                MeshRenderer: { material: { baseColorTextureAssetId: 'asset:missing-texture' } },
              },
            },
          ],
        },
      }),
    ).toThrow('Material references an unknown texture asset');
  });

  it('rejects malformed base64 asset payloads through the shared schema', () => {
    expect(() =>
      validateWorldDocument({
        ...world(),
        assets: [asset('asset:model')],
        assetPayloads: [
          {
            assetId: 'asset:model',
            mimeType: 'model/gltf-binary',
            encoding: 'base64',
            data: 'not base64!',
          },
        ],
      }),
    ).toThrow('Schema validation failed');
  });

  it('reports malformed JSON and invalid envelopes', () => {
    expect(() => parseWorld('{')).toThrow(WorldSerializationError);
    expect(() => validateWorldDocument({ format: 'wrong' })).toThrow('Unsupported world format');
  });

  it('runs explicit version migrations before validation', () => {
    const migrations = new WorldMigrationRegistry();
    migrations.register('0.9.0', (document) => ({
      ...document,
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      extensions: document.extensions ?? {},
    }));
    const legacy = { ...world(), schemaVersion: '0.9.0' };
    expect(parseWorld(JSON.stringify(legacy), migrations).schemaVersion).toBe(
      CURRENT_WORLD_SCHEMA_VERSION,
    );
  });

  it('rejects missing migration paths and non-advancing migrations', () => {
    expect(() => parseWorld(JSON.stringify({ ...world(), schemaVersion: '9.0.0' }))).toThrow(
      'No migration registered',
    );
    const migrations = new WorldMigrationRegistry();
    migrations.register('0.9.0', (document) => document);
    expect(() =>
      parseWorld(JSON.stringify({ ...world(), schemaVersion: '0.9.0' }), migrations),
    ).toThrow('did not advance');
  });
});
