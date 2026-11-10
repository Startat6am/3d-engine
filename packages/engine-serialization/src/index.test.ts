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

const world = (): WorldDocument => ({
  format: 'universal-3d-world',
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  engineVersion: '0.1.0',
  world: { id: 'world:test', name: 'Test', settings: {}, entities: [] },
  assets: [],
  extensions: {},
});

describe('world serialization', () => {
  it('round-trips a valid document with deterministic key ordering', () => {
    const source = serializeWorld(world());
    expect(parseWorld(source)).toEqual(world());
    expect(serializeWorld(parseWorld(source))).toBe(source);
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
    expect(parseWorld(JSON.stringify(legacy), migrations).schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
  });

  it('rejects missing migration paths and non-advancing migrations', () => {
    expect(() => parseWorld(JSON.stringify({ ...world(), schemaVersion: '9.0.0' }))).toThrow('No migration registered');
    const migrations = new WorldMigrationRegistry();
    migrations.register('0.9.0', (document) => document);
    expect(() => parseWorld(JSON.stringify({ ...world(), schemaVersion: '0.9.0' }), migrations)).toThrow('did not advance');
  });
});
