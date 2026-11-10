export const WORLD_FORMAT = 'universal-3d-world' as const;
export const CURRENT_WORLD_SCHEMA_VERSION = '1.0.0' as const;

export interface WorldDocument {
  readonly format: typeof WORLD_FORMAT;
  readonly schemaVersion: string;
  readonly engineVersion: string;
  readonly world: {
    readonly id: string;
    readonly name: string;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly entities: readonly unknown[];
  };
  readonly assets: readonly unknown[];
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export class WorldSerializationError extends Error {
  constructor(message: string, readonly path = '$') {
    super(`${message} at ${path}`);
    this.name = 'WorldSerializationError';
  }
}

export type WorldMigration = (document: Record<string, unknown>) => Record<string, unknown>;

export class WorldMigrationRegistry {
  readonly #migrations = new Map<string, WorldMigration>();

  register(fromVersion: string, migration: WorldMigration): void {
    if (this.#migrations.has(fromVersion)) throw new Error(`Migration already registered from ${fromVersion}`);
    this.#migrations.set(fromVersion, migration);
  }

  migrate(document: Record<string, unknown>, targetVersion = CURRENT_WORLD_SCHEMA_VERSION): Record<string, unknown> {
    let current = document;
    const visited = new Set<string>();
    while (current.schemaVersion !== targetVersion) {
      const version = current.schemaVersion;
      if (typeof version !== 'string' || visited.has(version)) {
        throw new WorldSerializationError('Invalid or cyclic migration chain', '$.schemaVersion');
      }
      visited.add(version);
      const migration = this.#migrations.get(version);
      if (!migration) throw new WorldSerializationError(`No migration registered from schema ${version}`, '$.schemaVersion');
      const next = migration(current);
      if (next === current || next.schemaVersion === version) {
        throw new WorldSerializationError('Migration did not advance schema version', '$.schemaVersion');
      }
      current = next;
    }
    return current;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the stable document envelope while leaving component payloads extensible. */
export function validateWorldDocument(value: unknown): asserts value is WorldDocument {
  if (!isRecord(value)) throw new WorldSerializationError('Expected a JSON object');
  if (value.format !== WORLD_FORMAT) throw new WorldSerializationError('Unsupported world format', '$.format');
  if (typeof value.schemaVersion !== 'string') throw new WorldSerializationError('Expected schema version string', '$.schemaVersion');
  if (typeof value.engineVersion !== 'string') throw new WorldSerializationError('Expected engine version string', '$.engineVersion');
  if (!isRecord(value.world)) throw new WorldSerializationError('Expected world object', '$.world');
  if (typeof value.world.id !== 'string' || typeof value.world.name !== 'string') {
    throw new WorldSerializationError('World id and name are required', '$.world');
  }
  if (!isRecord(value.world.settings)) throw new WorldSerializationError('Expected settings object', '$.world.settings');
  if (!Array.isArray(value.world.entities)) throw new WorldSerializationError('Expected entities array', '$.world.entities');
  if (!Array.isArray(value.assets)) throw new WorldSerializationError('Expected assets array', '$.assets');
  if (!isRecord(value.extensions)) throw new WorldSerializationError('Expected extensions object', '$.extensions');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function serializeWorld(document: WorldDocument, space = 2): string {
  validateWorldDocument(document);
  return JSON.stringify(canonicalize(document), null, space);
}

export function parseWorld(
  source: string,
  migrations = new WorldMigrationRegistry(),
): WorldDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw new WorldSerializationError(`Invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!isRecord(parsed)) throw new WorldSerializationError('Expected a JSON object');
  const migrated = parsed.schemaVersion === CURRENT_WORLD_SCHEMA_VERSION
    ? parsed
    : migrations.migrate(parsed);
  validateWorldDocument(migrated);
  if (migrated.schemaVersion !== CURRENT_WORLD_SCHEMA_VERSION) {
    throw new WorldSerializationError('Unsupported future or legacy schema version', '$.schemaVersion');
  }
  return migrated;
}
