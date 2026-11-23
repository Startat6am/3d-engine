import goldenFixture from '../fixtures/world-v1-assets.world.json' with { type: 'json' };
import legacyMigrationFixture from '../fixtures/world-v0.8.0.legacy.json' with { type: 'json' };
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
    expect(parsed.schemaVersion).toBe('1.1.0');
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assetPayloads?.[0]?.assetId).toBe('asset:model:triangle');
    const migratedFixture = { ...goldenFixture, schemaVersion: CURRENT_WORLD_SCHEMA_VERSION };
    expect(parsed).toEqual(migratedFixture);
    expect(serializeWorld(parsed)).toBe(JSON.stringify(migratedFixture, null, 2));
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
    const schemaUrl = new URL('./schemas/world-v1.1.schema.json', import.meta.url);
    const schema = await import(schemaUrl.href, { with: { type: 'json' } });
    expect(schema.default.$id).toBe('https://choreon.dev/schemas/world-v1.1.schema.json');
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

  it('requires material texture references to target assets of kind texture', () => {
    expect(() =>
      validateWorldDocument({
        ...world(),
        assets: [{ id: 'asset:model', kind: 'model' }],
        world: {
          ...world().world,
          entities: [
            {
              id: 'entity:mesh',
              components: { MeshRenderer: { material: { normalTextureAssetId: 'asset:model' } } },
            },
          ],
        },
      }),
    ).toThrow('Material reference must resolve to a texture asset');
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

  it('migrates world 1.0.0 by default without synthesizing components', () => {
    const original = {
      ...goldenFixture,
      world: {
        ...goldenFixture.world,
        entities: [
          {
            id: 'entity:audio-ready',
            components: {
              Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            },
          },
        ],
      },
    };
    const migrated = parseWorld(JSON.stringify(original));
    expect(migrated.schemaVersion).toBe('1.1.0');
    expect(migrated.world.entities).toEqual(original.world.entities);
    expect(migrated.assets).toEqual(original.assets);
    expect(migrated.assetPayloads).toEqual(original.assetPayloads);
    expect(migrated.extensions).toEqual(original.extensions);
    expect((migrated.world.entities[0] as { components: Record<string, unknown> }).components)
      .not.toHaveProperty('AudioSource');
  });

  it('accepts a transformed audio-only entity with a typed audio asset reference', () => {
    const document: WorldDocument = {
      ...world(),
      assets: [{ id: 'asset:audio', kind: 'audio' }],
      world: {
        ...world().world,
        entities: [
          {
            id: 'entity:audio-only',
            components: {
              Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              AudioSource: {
                assetId: 'asset:audio',
                spatial: true,
                loop: false,
                gain: 0.7,
                referenceDistance: 1,
                maxDistance: 50,
                playOnEnable: false,
              },
            },
          },
        ],
      },
    };
    expect(parseWorld(serializeWorld(document))).toEqual(document);
  });

  it('rejects AudioSource references with missing assets, wrong kinds or no Transform', () => {
    const entity = {
      id: 'entity:audio',
      components: {
        Transform: {},
        AudioSource: {
          assetId: 'asset:audio',
          spatial: true,
          loop: false,
          gain: 0.5,
          referenceDistance: 1,
          maxDistance: 10,
          playOnEnable: false,
        },
      },
    };
    expect(() =>
      validateWorldDocument({
        ...world(),
        world: { ...world().world, entities: [entity] },
      }),
    ).toThrow('AudioSource references an unknown asset');

    expect(() =>
      validateWorldDocument({
        ...world(),
        assets: [{ id: 'asset:audio', kind: 'model' }],
        world: { ...world().world, entities: [entity] },
      }),
    ).toThrow('must resolve to an audio asset');

    expect(() =>
      validateWorldDocument({
        ...world(),
        assets: [{ id: 'asset:audio', kind: 'audio' }],
        world: {
          ...world().world,
          entities: [{ ...entity, components: { AudioSource: entity.components.AudioSource } }],
        },
      }),
    ).toThrow('requires a Transform component');
  });

  it('rejects invalid AudioSource gain and distance ranges', () => {
    const source = {
      assetId: 'asset:audio',
      spatial: true,
      loop: false,
      gain: 1.5,
      referenceDistance: 2,
      maxDistance: 1,
      playOnEnable: false,
    };
    const document = {
      ...world(),
      assets: [{ id: 'asset:audio', kind: 'audio' }],
      world: {
        ...world().world,
        entities: [
          {
            id: 'entity:audio',
            components: { Transform: {}, AudioSource: source },
          },
        ],
      },
    };
    expect(() => validateWorldDocument(document)).toThrow('Schema validation failed');
    expect(() =>
      validateWorldDocument({
        ...document,
        world: {
          ...document.world,
          entities: [
            {
              id: 'entity:audio',
              components: {
                Transform: {},
                AudioSource: { ...source, gain: 0.5, maxDistance: 1 },
              },
            },
          ],
        },
      }),
    ).toThrow('not less than referenceDistance');
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

  it('migrates a legacy fixture through multiple schema versions in order', () => {
    const migrations = new WorldMigrationRegistry();
    migrations.register('0.8.0', (document) => ({
      ...document,
      schemaVersion: '0.9.0',
      extensions: {},
    }));
    migrations.register('0.9.0', (document) => ({
      ...document,
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      assetPayloads: [],
    }));

    const parsed = parseWorld(JSON.stringify(legacyMigrationFixture), migrations);
    expect(parsed.schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
    expect(parsed.world.name).toBe('Legacy migration fixture');
    expect(parsed.extensions).toEqual({});
    expect(parsed.assetPayloads).toEqual([]);
    expect(legacyMigrationFixture.schemaVersion).toBe('0.8.0');
  });

  it('rejects cyclic migration chains and duplicate migration registrations', () => {
    const migrations = new WorldMigrationRegistry();
    migrations.register('0.8.0', (document) => ({ ...document, schemaVersion: '0.9.0' }));
    migrations.register('0.9.0', (document) => ({ ...document, schemaVersion: '0.8.0' }));
    expect(() => parseWorld(JSON.stringify(legacyMigrationFixture), migrations)).toThrow(
      'Invalid or cyclic migration chain',
    );
    expect(() => migrations.register('0.8.0', (document) => document)).toThrow(
      'Migration already registered',
    );
  });
});
