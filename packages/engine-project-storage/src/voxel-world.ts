import {
  decodeVoxelChunkPayload,
  encodeVoxelChunkPayload,
  VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH,
  VOXEL_CHUNK_PAYLOAD_VERSION,
  type VoxelChunkSnapshot,
  type VoxelPaletteEntry,
} from '@engine/voxel';
import type { ChunkCoordinate3 } from '@engine/world';
import type { WorldDocument } from '@engine/serialization';
import {
  ProjectAssetStoreError,
  type ProjectFileStore,
  saveDirectoryProject,
  loadDirectoryProject,
} from './index.js';

export const VOXEL_WORLD_EXTENSION_KEY = 'com.choreon.voxel-world';
export const VOXEL_WORLD_EXTENSION_VERSION = 1;

export interface VoxelWorldSettings {
  readonly voxelSize: number;
  readonly chunkDimensions: Readonly<{ x: number; y: number; z: number }>;
}

interface VoxelChunkDescriptor {
  readonly coordinate: ChunkCoordinate3;
  readonly revision: number;
  readonly palette: readonly VoxelPaletteEntry[];
  readonly payload: {
    readonly assetId: string;
    readonly byteLength: number;
    readonly codecVersion: number;
    readonly contentHash: string;
  };
}

interface VoxelWorldExtension {
  readonly schemaVersion: number;
  readonly settings: VoxelWorldSettings;
  readonly chunks: readonly VoxelChunkDescriptor[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coordinateKey(coordinate: ChunkCoordinate3): string {
  return `${coordinate.x},${coordinate.y},${coordinate.z}`;
}

function validateSettings(settings: VoxelWorldSettings): void {
  if (!Number.isFinite(settings.voxelSize) || settings.voxelSize <= 0) {
    throw new ProjectAssetStoreError(
      'Voxel size must be a positive finite number',
      'INVALID_EXTENSION',
    );
  }
  if (!isRecord(settings.chunkDimensions)) {
    throw new ProjectAssetStoreError('Chunk dimensions must be an object', 'INVALID_EXTENSION');
  }
  for (const value of Object.values(settings.chunkDimensions)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ProjectAssetStoreError(
        'Chunk dimensions must be positive safe integers',
        'INVALID_EXTENSION',
      );
    }
  }
}

async function hashPayload(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function chunkBlobPath(hash: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(hash);
  if (!match) throw new ProjectAssetStoreError('Invalid voxel chunk SHA-256', 'INVALID_HASH');
  return `voxel/chunks/sha256/${match[1]!.slice(0, 2)}/${match[1]}.bin`;
}

/** Persists chunk blobs first and atomically writes the world manifest last. */
export async function saveVoxelWorldProject(
  store: ProjectFileStore,
  document: WorldDocument,
  settings: VoxelWorldSettings,
  chunks: readonly VoxelChunkSnapshot[],
): Promise<WorldDocument> {
  validateSettings(settings);
  const seen = new Set<string>();
  const descriptors: VoxelChunkDescriptor[] = [];
  const written = new Set<string>();
  for (const chunk of chunks) {
    const key = coordinateKey(chunk.coordinate);
    if (seen.has(key))
      throw new ProjectAssetStoreError(`Duplicate voxel chunk coordinate: ${key}`, 'INVALID_PATH');
    seen.add(key);
    const bytes = encodeVoxelChunkPayload(chunk);
    const contentHash = await hashPayload(bytes);
    const path = chunkBlobPath(contentHash);
    if (!written.has(path)) {
      await store.writeFile(path, bytes, { immutable: true });
      const persisted = await store.readFile(path);
      if ((await hashPayload(persisted)) !== contentHash) {
        throw new ProjectAssetStoreError(
          `Voxel chunk blob failed hash verification: ${key}`,
          'HASH_MISMATCH',
        );
      }
      written.add(path);
    }
    descriptors.push({
      coordinate: chunk.coordinate,
      revision: chunk.revision,
      palette: chunk.palette,
      payload: {
        assetId: `voxel-chunk:${contentHash.slice(7)}`,
        byteLength: VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH,
        codecVersion: VOXEL_CHUNK_PAYLOAD_VERSION,
        contentHash,
      },
    });
  }
  const extension: VoxelWorldExtension = {
    schemaVersion: VOXEL_WORLD_EXTENSION_VERSION,
    settings: { voxelSize: settings.voxelSize, chunkDimensions: { ...settings.chunkDimensions } },
    chunks: descriptors,
  };
  const next: WorldDocument = {
    ...document,
    extensions: { ...document.extensions, [VOXEL_WORLD_EXTENSION_KEY]: extension },
  };
  return saveDirectoryProject(store, next);
}

/** Loads and verifies every referenced chunk blob before exposing decoded snapshots. */
export async function loadVoxelWorldProject(store: ProjectFileStore): Promise<{
  readonly document: WorldDocument;
  readonly settings: VoxelWorldSettings;
  readonly chunks: readonly VoxelChunkSnapshot[];
}> {
  const document = await loadDirectoryProject(store);
  const raw = document.extensions[VOXEL_WORLD_EXTENSION_KEY];
  if (!isRecord(raw)) {
    throw new ProjectAssetStoreError('Voxel-world extension is missing', 'MISSING_PAYLOAD');
  }
  if (raw.schemaVersion !== VOXEL_WORLD_EXTENSION_VERSION) {
    throw new ProjectAssetStoreError(
      'Unsupported voxel-world extension version',
      'UNSUPPORTED_VERSION',
    );
  }
  if (!Array.isArray(raw.chunks) || !isRecord(raw.settings)) {
    throw new ProjectAssetStoreError(
      'Invalid voxel-world extension structure',
      'INVALID_EXTENSION',
    );
  }
  const settings = raw.settings as unknown as VoxelWorldSettings;
  validateSettings(settings);
  const seen = new Set<string>();
  const chunks: VoxelChunkSnapshot[] = [];
  for (const [index, rawChunk] of raw.chunks.entries()) {
    if (
      !isRecord(rawChunk) ||
      !isRecord(rawChunk.coordinate) ||
      !isRecord(rawChunk.payload) ||
      !Array.isArray(rawChunk.palette)
    ) {
      throw new ProjectAssetStoreError(
        `Invalid voxel chunk descriptor at index ${index}`,
        'MISSING_PAYLOAD',
      );
    }
    const coordinate = rawChunk.coordinate as unknown as ChunkCoordinate3;
    if (![coordinate.x, coordinate.y, coordinate.z].every(Number.isSafeInteger)) {
      throw new ProjectAssetStoreError(
        `Invalid voxel chunk coordinate at index ${index}`,
        'INVALID_PATH',
      );
    }
    const key = coordinateKey(coordinate);
    if (seen.has(key))
      throw new ProjectAssetStoreError(`Duplicate voxel chunk coordinate: ${key}`, 'INVALID_PATH');
    seen.add(key);
    const payload = rawChunk.payload;
    if (payload.codecVersion !== VOXEL_CHUNK_PAYLOAD_VERSION) {
      throw new ProjectAssetStoreError(
        `Unsupported voxel payload codec: ${String(payload.codecVersion)}`,
        'UNSUPPORTED_VERSION',
      );
    }
    if (
      payload.byteLength !== VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH ||
      typeof payload.contentHash !== 'string'
    ) {
      throw new ProjectAssetStoreError(`Invalid voxel payload metadata: ${key}`, 'MISSING_PAYLOAD');
    }
    if (payload.assetId !== `voxel-chunk:${payload.contentHash.slice(7)}`) {
      throw new ProjectAssetStoreError(
        `Voxel payload asset ID does not match its hash: ${key}`,
        'INVALID_EXTENSION',
      );
    }
    const bytes = await store.readFile(chunkBlobPath(payload.contentHash));
    if (
      bytes.byteLength !== payload.byteLength ||
      (await hashPayload(bytes)) !== payload.contentHash
    ) {
      throw new ProjectAssetStoreError(
        `Voxel chunk payload hash or length mismatch: ${key}`,
        'HASH_MISMATCH',
      );
    }
    chunks.push(
      decodeVoxelChunkPayload(
        {
          coordinate,
          revision: rawChunk.revision as number,
          palette: rawChunk.palette as VoxelPaletteEntry[],
        },
        bytes,
      ),
    );
  }
  return { document, settings, chunks };
}

export type { VoxelChunkSnapshot } from '@engine/voxel';
