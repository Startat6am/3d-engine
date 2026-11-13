import { normalizeAssetUri, type AssetRecord } from '@engine/assets';
import { parseWorld, serializeWorld, type WorldDocument } from '@engine/serialization';

export interface ProjectFileStore {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(
    path: string,
    data: Uint8Array,
    options?: { readonly immutable?: boolean },
  ): Promise<void>;
}

export class ProjectAssetStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_PATH'
      | 'INVALID_HASH'
      | 'HASH_MISMATCH'
      | 'MISSING_PAYLOAD'
      | 'NOT_FOUND'
      | 'IMMUTABLE_CONFLICT'
      | 'UNSUPPORTED_MIME',
  ) {
    super(message);
    this.name = 'ProjectAssetStoreError';
  }
}

export class MemoryProjectFileStore implements ProjectFileStore {
  readonly #files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Uint8Array> {
    const normalized = normalizeStorePath(path);
    const value = this.#files.get(normalized);
    if (!value)
      throw new ProjectAssetStoreError(`Project file not found: ${normalized}`, 'NOT_FOUND');
    return value.slice();
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    options: { readonly immutable?: boolean } = {},
  ): Promise<void> {
    const normalized = normalizeStorePath(path);
    const current = this.#files.get(normalized);
    if (options.immutable && current && !equalBytes(current, data)) {
      throw new ProjectAssetStoreError(
        `Refusing to overwrite immutable project asset: ${normalized}`,
        'IMMUTABLE_CONFLICT',
      );
    }
    if (!options.immutable || !current) this.#files.set(normalized, data.slice());
  }

  has(path: string): boolean {
    return this.#files.has(normalizeStorePath(path));
  }

  paths(): readonly string[] {
    return [...this.#files.keys()].sort();
  }
}

interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface WritableFileLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface FileHandleLike {
  getFile(): Promise<FileLike>;
  createWritable(options?: { readonly keepExistingData?: boolean }): Promise<WritableFileLike>;
}

export interface DirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<FileHandleLike>;
}

/** Browser adapter. The directory handle is a capability; paths never escape its root. */
export class BrowserProjectFileStore implements ProjectFileStore {
  constructor(private readonly root: DirectoryHandleLike) {}

  async readFile(path: string): Promise<Uint8Array> {
    try {
      const { directory, fileName } = await this.#resolveParent(path, false);
      const handle = await directory.getFileHandle(fileName);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new ProjectAssetStoreError(`Project file not found: ${path}`, 'NOT_FOUND');
      }
      throw error;
    }
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    options: { readonly immutable?: boolean } = {},
  ): Promise<void> {
    const normalized = normalizeStorePath(path);
    if (options.immutable) {
      try {
        const existing = await this.readFile(normalized);
        if (!equalBytes(existing, data)) {
          throw new ProjectAssetStoreError(
            `Refusing to overwrite immutable project asset: ${normalized}`,
            'IMMUTABLE_CONFLICT',
          );
        }
        return;
      } catch (error) {
        if (!(error instanceof ProjectAssetStoreError) || error.code !== 'NOT_FOUND') throw error;
      }
    }
    const { directory, fileName } = await this.#resolveParent(normalized, true);
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      await writable.abort?.();
      throw error;
    }
  }

  async #resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ directory: DirectoryHandleLike; fileName: string }> {
    const segments = normalizeStorePath(path).split('/');
    const fileName = segments.pop();
    if (!fileName)
      throw new ProjectAssetStoreError('Project path has no file name', 'INVALID_PATH');
    let directory = this.root;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create });
    }
    return { directory, fileName };
  }
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'model/gltf-binary': 'glb',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const EXTENSION_MIME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mimeType, extension]) => [extension, mimeType]),
);

function normalizeStorePath(path: string): string {
  try {
    if (path.includes('\0')) throw new Error('NUL byte');
    return normalizeAssetUri(path);
  } catch {
    throw new ProjectAssetStoreError(`Invalid project-relative path: ${path}`, 'INVALID_PATH');
  }
}

function parseSha256(contentHash: string): string {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(contentHash);
  if (!match)
    throw new ProjectAssetStoreError('Asset content hash is not a SHA-256 digest', 'INVALID_HASH');
  return match[1]!.toLowerCase();
}

function assetUri(contentHash: string, mimeType: string): string {
  const digest = parseSha256(contentHash);
  const extension = MIME_EXTENSIONS[mimeType] ?? 'bin';
  return `assets/sha256/${digest.slice(0, 2)}/${digest}.${extension}`;
}

function mimeTypeForAsset(record: AssetRecord, path: string): string {
  const metadataMime = record.metadata.mimeType;
  if (typeof metadataMime === 'string' && metadataMime.trim()) return metadataMime;
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new ProjectAssetStoreError(
      'Embedded asset payload is not valid Base64',
      'MISSING_PAYLOAD',
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x6000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return chunks.join('');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

/** Write all immutable blobs first, then atomically replace the world manifest last. */
export async function saveDirectoryProject(
  store: ProjectFileStore,
  document: WorldDocument,
): Promise<WorldDocument> {
  const records = document.assets as readonly AssetRecord[];
  const payloads = new Map(
    (document.assetPayloads ?? []).map((payload) => [payload.assetId, payload]),
  );
  const savedAssets: AssetRecord[] = [];
  const writtenBlobs = new Set<string>();

  for (const record of records) {
    const payload = payloads.get(record.id);
    if (!payload) {
      throw new ProjectAssetStoreError(`Asset payload is missing: ${record.id}`, 'MISSING_PAYLOAD');
    }
    const bytes = decodeBase64(payload.data);
    if ((await sha256(bytes)) !== `sha256:${parseSha256(record.contentHash)}`) {
      throw new ProjectAssetStoreError(
        `Asset payload hash mismatch: ${record.id}`,
        'HASH_MISMATCH',
      );
    }
    if (
      (record.kind === 'texture' && !payload.mimeType.startsWith('image/')) ||
      (record.kind === 'model' && payload.mimeType !== 'model/gltf-binary')
    ) {
      throw new ProjectAssetStoreError(
        `Asset kind ${record.kind} has invalid MIME type: ${payload.mimeType}`,
        'UNSUPPORTED_MIME',
      );
    }
    const uri = assetUri(record.contentHash, payload.mimeType);
    if (!writtenBlobs.has(uri)) {
      await store.writeFile(uri, bytes, { immutable: true });
      writtenBlobs.add(uri);
    }
    savedAssets.push({ ...record, uri });
  }

  const manifest = { ...document, assets: savedAssets } as WorldDocument & {
    assetPayloads?: unknown;
  };
  delete manifest.assetPayloads;
  // Do not write the manifest until every external blob has been written and verified.
  const manifestBytes = new TextEncoder().encode(serializeWorld(manifest));
  await store.writeFile('worlds/main.world', manifestBytes);
  return manifest;
}

/** Load and hash-check all external assets before returning a commit-ready world document. */
export async function loadDirectoryProject(store: ProjectFileStore): Promise<WorldDocument> {
  const manifestBytes = await store.readFile('worlds/main.world');
  const manifest = parseWorld(new TextDecoder().decode(manifestBytes));
  const payloads = new Map(
    (manifest.assetPayloads ?? []).map((payload) => [payload.assetId, payload] as const),
  );

  for (const rawRecord of manifest.assets) {
    const record = rawRecord as AssetRecord;
    const uri = normalizeStorePath(record.uri);
    const digest = parseSha256(record.contentHash);
    const expectedPrefix = `assets/sha256/${digest.slice(0, 2)}/${digest}.`;
    if (!uri.startsWith(expectedPrefix)) {
      throw new ProjectAssetStoreError(
        `Asset URI does not match its content hash: ${uri}`,
        'INVALID_PATH',
      );
    }
    const mimeType = mimeTypeForAsset(record, uri);
    if (uri !== assetUri(record.contentHash, mimeType)) {
      throw new ProjectAssetStoreError(
        `Asset URI extension does not match its MIME type: ${uri}`,
        'INVALID_PATH',
      );
    }
    if (payloads.has(record.id)) continue;
    const bytes = await store.readFile(uri);
    if ((await sha256(bytes)) !== `sha256:${parseSha256(record.contentHash)}`) {
      throw new ProjectAssetStoreError(
        `External asset hash mismatch: ${record.id}`,
        'HASH_MISMATCH',
      );
    }
    if (
      (record.kind === 'texture' && !mimeType.startsWith('image/')) ||
      (record.kind === 'model' && mimeType !== 'model/gltf-binary')
    ) {
      throw new ProjectAssetStoreError(
        `Asset kind ${record.kind} has invalid MIME type: ${mimeType}`,
        'UNSUPPORTED_MIME',
      );
    }
    payloads.set(record.id, {
      assetId: record.id,
      mimeType,
      encoding: 'base64',
      data: encodeBase64(bytes),
    });
  }

  return { ...manifest, assetPayloads: [...payloads.values()] };
}
