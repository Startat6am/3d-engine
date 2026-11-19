import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssetImportService,
  AssetImportScope,
  AssetRegistry,
  AssetResourceCache,
  type AssetResourceLease,
  type ImportedAsset,
  type AssetId,
  type AssetKind,
  type RegisterAssetInput,
} from '@engine/assets';
import type { Matrix4 as Matrix4Type } from 'three';
import type { GlbAsset } from '@engine/gltf-importer';
import type { WorldAssetPayload } from '@engine/serialization';
import {
  loadVoxelWorldProject,
  saveVoxelWorldProject,
  VOXEL_WORLD_EXTENSION_KEY,
  type VoxelWorldSettings,
  type VoxelChunkSnapshot,
} from '@engine/project-storage';
import { EditorHistory } from './EditorHistory.js';
import { readPbrMaterialState } from './materialValidation.js';
import { WorkerGlbImporter } from '../workers/WorkerGlbImporter.js';
import { parseWorld, serializeWorld, type WorldDocument } from '@engine/serialization';
import {
  createBoxGeometry,
  createCylinderGeometry,
  createPlaneGeometry,
  createUvSphereGeometry,
  validateMeshData,
  type MeshData,
} from '@engine/geometry';
import {
  createDefaultCamera,
  createDefaultMaterial,
  lookAtQuaternion,
} from '@engine/renderer/contracts';
import type { RenderObject, TextureSource, Vec3 } from '@engine/renderer/contracts';
import type { ThreeWebGLRendererAdapter } from '@engine/renderer';
import {
  BrowserProjectFileStore,
  loadDirectoryProject,
  type DirectoryHandleLike,
} from '../project/ProjectAssetStore.js';

type Transfor¶»§q«^