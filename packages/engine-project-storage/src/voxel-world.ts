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

function validateSettings(setti¶»§q«^