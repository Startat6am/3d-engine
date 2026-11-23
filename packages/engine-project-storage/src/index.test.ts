import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '@engine/assets';
import {
  CURRENT_WORLD_SCHEMA_VERSION,
  serializeWorld,
  type WorldDocument,
} from '@engine/serialization';
import {
  MemoryProjectFileStore,
  ProjectAssetStoreError,
  loadDirectoryProject,
  saveDirectoryProject,
} from './index.js';

const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);

async function contentHash(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer);
  return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function base64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

async function fixture(): Promise<WorldDocument> {
  const hash = await contentHash(bytes);
  const record = (id: string, name: string): AssetRecord => ({
    id: id as AssetRecord['id'],
    name,
    kind: 'texture',
    uri: `${name}.png`,
    contentHash: hash,
    importer: { id: 'test.image', version: '1.0.0', settings: {} },
    dependencies: [],
    metadata: { mimeType: 'image/png' },
  });
  return {
    format: 'universal-3d-world',
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    engineVersion: '0.1.0',
    world: { id: 'world:test', name: 'Test Project', settings: {}, entities: [] },
    assets: [record('asset:texture-a', 'texture-a'), record('asset:texture-b', 'texture-b')],
    assetPayloads: [
      {
        assetId: 'asset:texture-a',
        mimeType: 'image/png',
        encoding: 'base64',
        data: base64(bytes),
      },
      {
        assetId: 'asset:texture-b',
        mimeType: 'image/png',
        encoding: 'base64',
        data: base64(bytes),
      },
    ],
    extensions: {},
  };
}

class RecordingStore extends MemoryProjectFileStore {
  readonly writes: string[] = [];

  override async writeFile(
    path: string,
    data: Uint8Array,
    options?: { readonly immutable?: boolean },
  ): Promise<void> {
    this.writes.push(path);
    await super.writeFile(path, data, options);
  }
}

describe('directory project asset store', () => {
  it('writes immutable content-addressed blobs before a manifest without embedded payloads', async () => {
    const store = new RecordingStore();
    const document = await fixture();
    const manifest = await saveDirectoryProject(store, document);

    expect(store.writes.at(-1)).toBe('worlds/main.world');
    expect(store.writes).toHaveLength(2);
    expect(store.writes[0]).toMatch(/^assets\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
    expect(store.writes[1]).toBe('worlds/main.world');
    expect(store.has(store.writes[0]!)).toBe(true);
    expect(manifest.assetPayloads).toBeUndefined();
    expect((manifest.assets as AssetRecord[]).map((asset) => asset.uri)).toEqual([
      store.writes[0],
      store.writes[0],
    ]);
    const savedManifest = new TextDecoder().decode(await store.readFile('worlds/main.world'));
    expect(savedManifest).not.toContain('assetPayloads');
    expect(savedManifest).toContain(store.writes[0]!);
  });

  it('reopens external assets and reconstructs verified in-memory payloads', async () => {
    const store = new MemoryProjectFileStore();
    await saveDirectoryProject(store, await fixture());

    const restored = await loadDirectoryProject(store);
    expect(restored.world.name).toBe('Test Project');
    expect(restored.assetPayloads).toHaveLength(2);
    expect(restored.assetPayloads?.map((payload) => payload.data)).toEqual([
      base64(bytes),
      base64(bytes),
    ]);
  });

  it('round-trips audio assets and AudioSource references through project storage', async () => {
    const store = new MemoryProjectFileStore();
    const document = await fixture();
    const audioBytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
    const audioHash = await contentHash(audioBytes);
    const audioAsset: AssetRecord = {
      id: 'asset:audio:test' as AssetRecord['id'],
      name: 'Spatial test tone',
      kind: 'audio',
      uri: 'audio/test.wav',
      contentHash: audioHash,
      importer: { id: 'test.audio', version: '1.0.0', settings: {} },
      dependencies: [],
      metadata: { mimeType: 'audio/wav' },
    };
    const withAudio: WorldDocument = {
      ...document,
      assets: [...(document.assets as AssetRecord[]), audioAsset],
      assetPayloads: [
        ...document.assetPayloads!,
        {
          assetId: audioAsset.id,
          mimeType: 'audio/wav',
          encoding: 'base64',
          data: base64(audioBytes),
        },
      ],
      world: {
        ...document.world,
        entities: [
          {
            id: 'entity:audio-only',
            components: {
              Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              AudioSource: {
                assetId: audioAsset.id,
                spatial: true,
                loop: true,
                gain: 0.6,
                referenceDistance: 1,
                maxDistance: 40,
                playOnEnable: false,
              },
            },
          },
        ],
      },
    };

    const manifest = await saveDirectoryProject(store, withAudio);
    expect(
      (manifest.assets as AssetRecord[]).find((asset) => asset.id === audioAsset.id)?.uri,
    ).toMatch(/\.wav$/);
    const restored = await loadDirectoryProject(store);
    expect(restored.schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
    expect(restored.world.entities).toEqual(withAudio.world.entities);
    expect(
      restored.assetPayloads?.find((payload) => payload.assetId === audioAsset.id),
    ).toMatchObject({
      mimeType: 'audio/wav',
      data: base64(audioBytes),
    });
  });

  it('rejects texture MIME types that the Editor renderer cannot decode', async () => {
    const store = new MemoryProjectFileStore();
    const document = await fixture();
    const invalid: WorldDocument = {
      ...document,
      assetPayloads: document.assetPayloads!.map((payload) => ({
        ...payload,
        mimeType: 'image/gif',
      })),
    };

    await expect(saveDirectoryProject(store, invalid)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MIME',
    });
    expect(store.has('worlds/main.world')).toBe(false);
  });

  it('does not replace the manifest when any source payload fails hash verification', async () => {
    const store = new MemoryProjectFileStore();
    const document = await fixture();
    await store.writeFile('worlds/main.world', new TextEncoder().encode('previous manifest'));
    const invalid: WorldDocument = {
      ...document,
      assetPayloads: document.assetPayloads!.map((payload, index) =>
        index === 0 ? { ...payload, data: base64(new Uint8Array([9, 9, 9])) } : payload,
      ),
    };

    await expect(saveDirectoryProject(store, invalid)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    });
    expect(new TextDecoder().decode(await store.readFile('worlds/main.world'))).toBe(
      'previous manifest',
    );
  });

  it('does not commit the manifest if a written blob fails read-back verification', async () => {
    class CorruptingStore extends MemoryProjectFileStore {
      override async writeFile(
        path: string,
        data: Uint8Array,
        options?: { readonly immutable?: boolean },
      ): Promise<void> {
        await super.writeFile(path, data, options);
        if (options?.immutable) await super.writeFile(path, new Uint8Array([7, 7, 7]));
      }
    }
    const store = new CorruptingStore();
    await store.writeFile('worlds/main.world', new TextEncoder().encode('previous manifest'));

    await expect(saveDirectoryProject(store, await fixture())).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    });
    expect(new TextDecoder().decode(await store.readFile('worlds/main.world'))).toBe(
      'previous manifest',
    );
  });

  it('leaves the previous manifest intact if the final manifest write fails', async () => {
    class ManifestFailStore extends MemoryProjectFileStore {
      failManifest = false;

      override async writeFile(
        path: string,
        data: Uint8Array,
        options?: { readonly immutable?: boolean },
      ): Promise<void> {
        if (this.failManifest && path === 'worlds/main.world') {
          throw new Error('simulated manifest commit failure');
        }
        await super.writeFile(path, data, options);
      }
    }
    const store = new ManifestFailStore();
    await store.writeFile('worlds/main.world', new TextEncoder().encode('previous manifest'));
    store.failManifest = true;

    await expect(saveDirectoryProject(store, await fixture())).rejects.toThrow(
      'simulated manifest commit failure',
    );
    expect(new TextDecoder().decode(await store.readFile('worlds/main.world'))).toBe(
      'previous manifest',
    );
    expect(store.paths().some((path) => path.startsWith('assets/sha256/'))).toBe(true);
  });

  it('rejects a tampered external blob before returning a world document', async () => {
    const store = new MemoryProjectFileStore();
    const manifest = await saveDirectoryProject(store, await fixture());
    const asset = (manifest.assets as AssetRecord[])[0]!;
    await store.writeFile(asset.uri, new Uint8Array([8, 8, 8]));

    await expect(loadDirectoryProject(store)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
  });

  it('rejects a missing external blob before returning a world document', async () => {
    const source = new MemoryProjectFileStore();
    const manifest = await saveDirectoryProject(source, await fixture());
    const missingStore = new MemoryProjectFileStore();
    await missingStore.writeFile('worlds/main.world', await source.readFile('worlds/main.world'));

    const missingAsset = (manifest.assets as AssetRecord[])[0]!;
    expect(source.has(missingAsset.uri)).toBe(true);
    expect(missingStore.has(missingAsset.uri)).toBe(false);
    await expect(loadDirectoryProject(missingStore)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects traversal paths before attempting external file access', async () => {
    const store = new MemoryProjectFileStore();
    const document = await fixture();
    const documentWithoutPayloads = Object.fromEntries(
      Object.entries(document).filter(([key]) => key !== 'assetPayloads'),
    ) as WorldDocument;
    const unsafe: WorldDocument = {
      ...documentWithoutPayloads,
      assets: (document.assets as AssetRecord[]).map((asset, index) =>
        index === 0 ? { ...asset, uri: '../outside.png' } : asset,
      ),
    };
    await store.writeFile('worlds/main.world', new TextEncoder().encode(serializeWorld(unsafe)));

    await expect(loadDirectoryProject(store)).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(loadDirectoryProject(store)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('never overwrites a content-addressed blob with different bytes', async () => {
    const store = new MemoryProjectFileStore();
    await store.writeFile('assets/sha256/aa/blob.png', bytes, { immutable: true });

    await expect(
      store.writeFile('assets/sha256/aa/blob.png', new Uint8Array([1]), { immutable: true }),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CONFLICT' });
  });
});
