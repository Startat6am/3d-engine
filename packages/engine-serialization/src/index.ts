export const WORLD_FORMAT = 'universal-3d-world' as const;
export const CURRENT_WORLD_SCHEMA_VERSION = '1.0.0' as const;

export interface WorldAssetPayload {
  readonly assetId: string;
  readonly mimeType: string;
  readonly encoding: 'base64';
  readonly data: string;
}

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
  readonly assetPayloads?: readonly WorldAssetPayload[];
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export class WorldSerializationError extends Error {
  constructor(
    message: string,
    readonly path = '$',
  ) {
    super(`${message} at ${path}`);
    this.name = 'WorldSerializationError';
  }
}

export type WorldMigration = (document: Record<string, unknown>) => Record<string, unknown>;

export class WorldMigrationRegistry {
  readonly #migrations = new Map<string, WorldMigration>();

  register(fromVersion: string, migration: WorldMigration): void {
    if (this.#migrations.has(fromVersion))
      throw new Error(`Migration already registered from ${fromVersion}`);
    this.#migrations.set(fromVersion, migration);
  }

  migrate(
    document: Record<string, unknown>,
    targetVersion = CURRENT_WORLD_SCHEMA_VERSION,
  ): Record<string, unknown> {
    let current = document;
    const visited = new Set<string>();
    while (current.schemaVersion !== targetVersion) {
      const version = current.schemaVersion;
      if (typeof version !== 'string' || visited.has(version)) {
        throw new WorldSerializationError('Invalid or cyclic migration chain', '$.schemaVersion');
      }
      visited.add(version);
      const migration = this.#migrations.get(version);
      if (!migration)
        throw new WorldSerializationError(
          `No migration registered from schema ${version}`,
          '$.schemaVersion',
        );
      const next = migration(current);
      if (next === current || next.schemaVersion === version) {
        throw new WorldSerializationError(
          'Migration did not advance schema version',
          '$.schemaVersion',
        );
      }
      current = next;
    }
    return current;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates cross-document asset links without interpreting opaque component payloads. */
function validateWorldAssetReferences(document: Record<string, unknown>): void {
  const assets = document.assets;
  if (!Array.isArray(assets)) return;

  const assetIds = new Set<string>();
  const assetIndexes = new Map<string, number>();
  const dependencies = new Map<string, string[]>();
  for (const [index, asset] of assets.entries()) {
    const path = `$.assets[${index}]`;
    if (!isRecord(asset) || typeof asset.id !== 'string' || !asset.id.trim()) {
      throw new WorldSerializationError('Asset must have a non-empty ID', `${path}.id`);
    }
    if (assetIds.has(asset.id)) {
      throw new WorldSerializationError('Duplicate asset ID', `${path}.id`);
    }
    assetIds.add(asset.id);
    assetIndexes.set(asset.id, index);
    if (asset.dependencies !== undefined) {
      if (
        !Array.isArray(asset.dependencies) ||
        !asset.dependencies.every((dependency) => typeof dependency === 'string')
      ) {
        throw new WorldSerializationError(
          'Asset dependencies must be an array of asset IDs',
          `${path}.dependencies`,
        );
      }
      dependencies.set(asset.id, asset.dependencies as string[]);
    } else {
      dependencies.set(asset.id, []);
    }
  }

  for (const [assetId, required] of dependencies) {
    for (const dependency of required) {
      if (!assetIds.has(dependency)) {
        throw new WorldSerializationError(
          `Asset dependency does not exist: ${dependency}`,
          `$.assets[${assetIndexes.get(assetId)}].dependencies`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (assetId: string): void => {
    if (visiting.has(assetId)) {
      throw new WorldSerializationError('Asset dependency cycle detected', '$.assets');
    }
    if (visited.has(assetId)) return;
    visiting.add(assetId);
    for (const dependency of dependencies.get(assetId) ?? []) visit(dependency);
    visiting.delete(assetId);
    visited.add(assetId);
  };
  for (const assetId of assetIds) visit(assetId);

  const world = document.world as Record<string, unknown>;
  const entities = world.entities as unknown[];
  for (const [index, entity] of entities.entries()) {
    if (!isRecord(entity) || !isRecord(entity.components)) continue;
    const meshRenderer = entity.components.MeshRenderer;
    if (!isRecord(meshRenderer) || meshRenderer.assetId === undefined) continue;
    if (typeof meshRenderer.assetId !== 'string' || !assetIds.has(meshRenderer.assetId)) {
      throw new WorldSerializationError(
        `Entity references an unknown asset: ${String(meshRenderer.assetId)}`,
        `$.world.entities[${index}].components.MeshRenderer.assetId`,
      );
    }
  }

  const payloads = (document.assetPayloads as unknown[] | undefined) ?? [];
  for (const [index, payload] of payloads.entries()) {
    if (
      isRecord(payload) &&
      typeof payload.assetId === 'string' &&
      !assetIds.has(payload.assetId)
    ) {
      throw new WorldSerializationError(
        `Embedded payload references an unknown asset: ${payload.assetId}`,
        `$.assetPayloads[${index}].assetId`,
      );
    }
  }
}

/** Validates the stable document envelope while leaving component payloads extensible. */
export function validateWorldDocument(value: unknown): asserts value is WorldDocument {
  if (!isRecord(value)) throw new WorldSerializationError('Expected a JSON object');
  if (value.format !== WORLD_FORMAT)
    throw new WorldSerializationError('Unsupported world format', '$.format');
  if (typeof value.schemaVersion !== 'string')
    throw new WorldSerializationError('Expected schema version string', '$.schemaVersion');
  if (typeof value.engineVersion !== 'string')
    throw new WorldSerializationError('Expected engine version string', '$.engineVersion');
  if (!isRecord(value.world)) throw new WorldSerializationError('Expected world object', '$.world');
  if (typeof value.world.id !== 'string' || typeof value.world.name !== 'string') {
    throw new WorldSerializationError('World id and name are required', '$.world');
  }
  if (!isRecord(value.world.settings))
    throw new WorldSerializationError('Expected settings object', '$.world.settings');
  if (!Array.isArray(value.world.entities))
    throw new WorldSerializationError('Expected entities array', '$.world.entities');
  if (!Array.isArray(value.assets))
    throw new WorldSerializationError('Expected assets array', '$.assets');
  if (value.assetPayloads !== undefined) {
    if (!Array.isArray(value.assetPayloads)) {
      throw new WorldSerializationError('Expected asset payloads array', '$.assetPayloads');
    }
    const assetIds = new Set<string>();
    for (const [index, payload] of value.assetPayloads.entries()) {
      const path = `$.assetPayloads[${index}]`;
      if (
        !isRecord(payload) ||
        typeof payload.assetId !== 'string' ||
        typeof payload.mimeType !== 'string' ||
        payload.encoding !== 'base64' ||
        typeof payload.data !== 'string' ||
        payload.data.length === 0
      ) {
        throw new WorldSerializationError('Invalid embedded asset payload', path);
      }
      if (assetIds.has(payload.assetId)) {
        throw new WorldSerializationError('Duplicate asset payload ID', `${path}.assetId`);
      }
      assetIds.add(payload.assetId);
    }
  }
  if (!isRecord(value.extensions))
    throw new WorldSerializationError('Expected extensions object', '$.extensions');
  validateWorldAssetReferences(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
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
    throw new WorldSerializationError(
      `Invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!isRecord(parsed)) throw new WorldSerializationError('Expected a JSON object');
  const migrated =
    parsed.schemaVersion === CURRENT_WORLD_SCHEMA_VERSION ? parsed : migrations.migrate(parsed);
  validateWorldDocument(migrated);
  if (migrated.schemaVersion !== CURRENT_WORLD_SCHEMA_VERSION) {
    throw new WorldSerializationError(
      'Unsupported future or legacy schema version',
      '$.schemaVersion',
    );
  }
  return migrated;
}
