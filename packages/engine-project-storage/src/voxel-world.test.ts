import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '@engine/assets';
import voxelWorldV1Fixture from '../fixtures/voxel-world-v1.json' with { type: 'json' };
import { createVoxelChunkSnapshot } from '@engine/voxel';
import type { WorldDocument } from '@engine/serialization';
import {
  MemoryProjectFileStore,
  ProjectAssetStoreError,
  loadVoxelWorldProject,
  saveVoxelWorldProject,
} from './index.js';

const document: WorldDocument = {
  format: 'universal-3d-world',
  schemaVersion: '1.0.0',
  engineVersion: '0.1.0',
  world: { id: 'world:voxel-test', name: 'Voxel Test', settings: {}, entities: [] },
  assets: [],
  extensions: {},
};

function chunk(x: number) {
  return createVoxelChunkSnapshot({
    coordinate: { x, y: -2, z: 3 },
    revision: 9,
    palette: [{ material: { kind: 'builtin', key: 'stone' } }],
    cells: new Uint16Array(4096).fill(1),
  });
}

const settings = { voxelSize: 0.5, chunkDimensions: { x: 16, y: 16, z: 16 } };

class RecordingStore extends MemoryProjectFileStore {
  readonly writes: string[] = [];

  override async writeFile(
    path: string,
    data: Uint8Array,
    options?: { readonly immutable?: boolean },
  ) {
    this.writes.push(path);
    await super.writeFile(path, data, options);
  }
}

describe('voxel world project persistence', () => {
  it('loads the checked-in v1 voxel-world compatibility fixture', async () => {
    const store = new MemoryProjectFileStore();
    await store.writeFile(
      'worlds/main.world',
      new TextEncoder().encode(JSON.stringify(voxelWorldV1Fixture)),
    );

    const loaded = await loadVoxelWorldProject(store);
    expect(loaded.document.world.name).toBe('Voxel World v1 Fixture');
    expect(loaded.settings).toEqual({
      voxelSize: 1,
      chunkDimensions: { x: 16, y: 16, z: 16 },
    });
    expect(loaded.chunks).toEqual([]);
  });

  it('round-trips custom voxel material assets and their embedded source payloads', async () => {
    const source = new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, name: 'Copper Alloy', color: 0xb87333, roughness: 0.9 }),
    );
    const digest = await crypto.subtle.digest('SHA-256', source.slice().buffer as ArrayBuffer);
    const contentHash = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const assetId = 'asset:voxel-material-copper';
    const asset: AssetRecord = {
      id: assetId as AssetRecord['id'],
      name: 'Copper Alloy',
      kind: 'material',
      uri: 'materials/voxel/copper.json',
      contentHash,
      importer: { id: 'choreon.voxel-material', version: '1', settings: {} },
      dependencies: [],
      metadata: {
        role: 'voxel-material',
        color: 0xb87333,
        roughness: 0.9,
        mimeType: 'application/vnd.choreon.voxel-material+json',
      },
    };
    const materialDocument: WorldDocument = {
      ...document,
      assets: [asset],
      assetPayloads: [
        {
          assetId,
          mimeType: 'application/vnd.choreon.voxel-material+json',
          encoding: 'base64',
          data: btoa(String.fromCharCode(...source)),
        },
      ],
    };
    const customMaterialChunk = createVoxelChunkSnapshot({
      coordinate: { x: 0, y: 0, z: 0 },
      palette: [{ material: { kind: 'asset', assetId } }],
      cells: new Uint16Array(4096).fill(1),
    });
    const store = new MemoryProjectFileStore();
    await saveVoxelWorldProject(store, materialDocument, settings, [customMaterialChunk]);
    const loaded = await loadVoxelWorldProject(store);
    expect(loaded.document.assets).toHaveLength(1);
    expect(loaded.document.assets[0]).toMatchObject({
      id: assetId,
      kind: 'material',
      contentHash,
      metadata: { role: 'voxel-material', color: 0xb87333, roughness: 0.9 },
    });
    expect(loaded.chunks[0]?.palette).toEqual([{ material: { kind: 'asset', assetId } }]);
    expect(loaded.document.assetPayloads?.[0]).toMatchObject({
      assetId,
      mimeType: 'application/vnd.choreon.voxel-material+json',
      encoding: 'base64',
      data: btoa(String.fromCharCode(...source)),
    });
  });

  it('round-trips chunk metadata and cells using content-addressed blobs', async () => {
    const store = new RecordingStore();
    await saveVoxelWorldProject(store, document, settings, [chunk(-1), chunk(1)]);
    const loaded = await loadVoxelWorldProject(store);
    expect(loaded.settings).toEqual(settings);
    expect(loaded.chunks).toHaveLength(2);
    expect(loaded.chunks[0]!.coordinate).toEqual({ x: -1, y: -2, z: 3 });
    expect(loaded.chunks[1]!.coordinate).toEqual({ x: 1, y: -2, z: 3 });
    expect(loaded.chunks[0]!.revision).toBe(9);
    expect(loaded.chunks[0]!.palette).toEqual([{ material: { kind: 'builtin', key: 'stone' } }]);
    expect(loaded.chunks[0]!.copyCells()).toEqual(new Uint16Array(4096).fill(1));
    expect(store.paths().some((path) => path.startsWith('voxel/chunks/sha256/'))).toBe(true);
    expect(store.paths()).toContain('worlds/main.world');
    expect(store.paths().filter((path) => path.startsWith('voxel/chunks/sha256/'))).toHaveLength(1);
    expect(store.writes.at(-1)).toBe('worlds/main.world');
  });

  it('rejects invalid voxel settings', async () => {
    const store = new MemoryProjectFileStore();
    await expect(
      saveVoxelWorldProject(store, document, { ...settings, voxelSize: 0 }, []),
    ).rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
    expect(store.paths()).not.toContain('worlds/main.world');
  });

  it('rejects unsupported extension schema versions', async () => {
    const store = new MemoryProjectFileStore();
    await saveVoxelWorldProject(store, document, settings, [chunk(4)]);
    const manifest = JSON.parse(
      new TextDecoder().decode(await store.readFile('worlds/main.world')),
    ) as {
      extensions: Record<string, { schemaVersion: number }>;
    };
    manifest.extensions['com.choreon.voxel-world']!.schemaVersion = 99;
    await store.writeFile('worlds/main.world', new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(loadVoxelWorldProject(store)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
    });
  });

  it('rejects duplicate chunk coordinates before writing the manifest', async () => {
    const store = new MemoryProjectFileStore();
    await expect(
      saveVoxelWorldProject(store, document, settings, [chunk(1), chunk(1)]),
    ).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(store.paths()).not.toContain('worlds/main.world');
  });

  it('rejects unsupported payload codec versions', async () => {
    const store = new MemoryProjectFileStore();
    await saveVoxelWorldProject(store, document, settings, [chunk(2)]);
    const manifest = JSON.parse(
      new TextDecoder().decode(await store.readFile('worlds/main.world')),
    ) as {
      extensions: Record<string, { chunks: Array<{ payload: { codecVersion: number } }> }>;
    };
    manifest.extensions['com.choreon.voxel-world']!.chunks[0]!.payload.codecVersion = 99;
    await store.writeFile('worlds/main.world', new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(loadVoxelWorldProject(store)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
    });
  });

  it('rejects missing chunk blobs', async () => {
    const store = new MemoryProjectFileStore();
    await saveVoxelWorldProject(store, document, settings, [chunk(3)]);
    const manifest = JSON.parse(
      new TextDecoder().decode(await store.readFile('worlds/main.world')),
    ) as {
      extensions: Record<
        string,
        { chunks: Array<{ payload: { assetId: string; contentHash: string } }> }
      >;
    };
    const payload = manifest.extensions['com.choreon.voxel-world']!.chunks[0]!.payload;
    payload.contentHash = `sha256:${'0'.repeat(64)}`;
    payload.assetId = `voxel-chunk:${'0'.repeat(64)}`;
    await store.writeFile('worlds/main.world', new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(loadVoxelWorldProject(store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects corrupted chunk blobs on load', async () => {
    const store = new MemoryProjectFileStore();
    await saveVoxelWorldProject(store, document, settings, [chunk(0)]);
    const manifest = JSON.parse(
      new TextDecoder().decode(await store.readFile('worlds/main.world')),
    ) as {
      extensions: Record<string, { chunks: { payload: { contentHash: string } }[] }>;
    };
    const hash = manifest.extensions['com.choreon.voxel-world']!.chunks[0]!.payload.contentHash;
    const digest = hash.slice('sha256:'.length);
    await store.writeFile(
      `voxel/chunks/sha256/${digest.slice(0, 2)}/${digest}.bin`,
      new Uint8Array([1]),
    );
    await expect(loadVoxelWorldProject(store)).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(loadVoxelWorldProject(store)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
  });
});
