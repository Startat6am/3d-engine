export type AssetId = string & { readonly __assetId: unique symbol };

export type AssetKind =
  | 'model'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'audio'
  | 'animation'
  | 'environment'
  | 'other';

export interface AssetRecord {
  readonly id: AssetId;
  readonly name: string;
  readonly kind: AssetKind;
  /** Normalized URI relative to the project root. */
  readonly uri: string;
  readonly contentHash: string;
  readonly importer: {
    readonly id: string;
    readonly version: string;
    readonly settings: Readonly<Record<string, string | number | boolean>>;
  };
  readonly dependencies: readonly AssetId[];
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface RegisterAssetInput extends Omit<AssetRecord, 'id' | 'uri' | 'dependencies'> {
  readonly id?: AssetId;
  readonly uri: string;
  readonly dependencies?: readonly AssetId[];
}

export class AssetRegistryError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_ID' | 'INVALID_URI' | 'DUPLICATE_ID' | 'MISSING_DEPENDENCY' | 'DEPENDENCY_CYCLE' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'AssetRegistryError';
  }
}

const ASSET_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

/** Normalize a project-relative asset URI and reject traversal or external locations. */
export function normalizeAssetUri(uri: string): string {
  if (!uri || uri.includes('\\') || uri.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(uri) || uri.includes('?') || uri.includes('#')) {
    throw new AssetRegistryError('Asset URI must be a project-relative path', 'INVALID_URI');
  }
  const segments = uri.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new AssetRegistryError('Asset URI contains an invalid path segment', 'INVALID_URI');
  }
  return segments.join('/');
}

function freezeRecord(input: RegisterAssetInput): AssetRecord {
  if (input.id && !ASSET_ID_PATTERN.test(input.id)) {
    throw new AssetRegistryError('Asset ID has an invalid format', 'INVALID_ID');
  }
  if (!input.name.trim() || !input.importer.id.trim() || !input.importer.version.trim()) {
    throw new AssetRegistryError('Asset name and importer identity are required', 'INVALID_ID');
  }
  return Object.freeze({
    ...input,
    id: input.id ?? `asset:${crypto.randomUUID()}` as AssetId,
    uri: normalizeAssetUri(input.uri),
    importer: Object.freeze({ ...input.importer, settings: Object.freeze({ ...input.importer.settings }) }),
    dependencies: Object.freeze([...(input.dependencies ?? [])]),
    metadata: Object.freeze({ ...input.metadata }),
  });
}

/** Project-scoped stable identity registry. It deliberately owns metadata, not decoded/GPU resources. */
export class AssetRegistry {
  readonly #records = new Map<AssetId, AssetRecord>();

  register(input: RegisterAssetInput): AssetRecord {
    const record = freezeRecord(input);
    if (this.#records.has(record.id)) {
      throw new AssetRegistryError(`Asset already registered: ${record.id}`, 'DUPLICATE_ID');
    }
    for (const dependency of record.dependencies) {
      if (!this.#records.has(dependency)) {
        throw new AssetRegistryError(`Missing asset dependency: ${dependency}`, 'MISSING_DEPENDENCY');
      }
      if (dependency === record.id || this.#dependsOn(dependency, record.id)) {
        throw new AssetRegistryError('Asset dependency cycle detected', 'DEPENDENCY_CYCLE');
      }
    }
    this.#records.set(record.id, record);
    return record;
  }

  get(id: AssetId): AssetRecord | undefined {
    return this.#records.get(id);
  }

  require(id: AssetId): AssetRecord {
    const record = this.get(id);
    if (!record) throw new AssetRegistryError(`Unknown asset: ${id}`, 'NOT_FOUND');
    return record;
  }

  has(id: AssetId): boolean {
    return this.#records.has(id);
  }

  list(kind?: AssetKind): readonly AssetRecord[] {
    return [...this.#records.values()].filter((record) => !kind || record.kind === kind);
  }

  remove(id: AssetId): boolean {
    if (!this.#records.has(id)) return false;
    if ([...this.#records.values()].some((record) => record.dependencies.includes(id))) {
      throw new AssetRegistryError('Cannot remove an asset that is still referenced', 'MISSING_DEPENDENCY');
    }
    return this.#records.delete(id);
  }

  clear(): void {
    this.#records.clear();
  }

  get size(): number {
    return this.#records.size;
  }

  #dependsOn(from: AssetId, target: AssetId, visited = new Set<AssetId>()): boolean {
    if (visited.has(from)) return false;
    visited.add(from);
    const record = this.#records.get(from);
    return Boolean(record?.dependencies.some((dependency) => dependency === target || this.#dependsOn(dependency, target, visited)));
  }
}
