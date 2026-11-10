import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function makeTriangleGlb(): Buffer {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const normals = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  const binary = Buffer.concat([positions, normals, image]);
  const document = {
    asset: { version: '2.0', generator: 'editor-assets-e2e' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: normals.length },
      { buffer: 0, byteOffset: positions.length + normals.length, byteLength: image.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    images: [{ name: 'One pixel', mimeType: 'image/png', bufferView: 2 }],
    textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [
      { name: 'Triangle', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] },
    ],
    nodes: [{ name: 'TriangleNode', mesh: 0, translation: [1, 0, 0] }],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

test('GLB imports register stable project assets and survive world save/reopen', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await page.locator('input[accept=".glb,model/gltf-binary"]').setInputFiles({
    name: 'triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(),
  });
  await expect(page.getByText('TriangleNode')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(consoleErrors).toEqual([]);

  const saveWorld = async () => {
    const menu = page.locator('.file-menu');
    if (!(await menu.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await page.locator('.file-menu summary').click();
    }
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save World…' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error('World export did not produce a file');
    return readFile(path, 'utf8');
  };

  const firstSave = await saveWorld();
  const firstDocument = JSON.parse(firstSave) as {
    assets: Array<{
      id: string;
      kind: string;
      uri: string;
      contentHash: string;
      importer: { id: string };
      dependencies: string[];
    }>;
    assetPayloads: Array<{ assetId: string; mimeType: string; encoding: string; data: string }>;
    world: {
      entities: Array<{
        components?: {
          MeshRenderer?: { assetId?: string; material?: { baseColorTextureAssetId?: string } };
        };
      }>;
    };
  };
  expect(firstDocument.assets).toHaveLength(2);
  const asset = firstDocument.assets.find((item) => item.kind === 'model')!;
  const texture = firstDocument.assets.find((item) => item.kind === 'texture')!;
  expect(asset.uri).toBe('imports/triangle.glb');
  expect(asset.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(asset.importer.id).toBe('engine.gltf.glb');
  expect(asset.dependencies).toContain(texture.id);
  expect(texture.uri).toBe('imports/triangle.glb.image-0.png');
  expect(texture.importer.id).toBe('engine.gltf.embedded-image');
  const importedEntity = firstDocument.world.entities.find(
    (entity) => entity.components?.MeshRenderer?.assetId,
  );
  expect(importedEntity?.components?.MeshRenderer?.assetId).toBe(asset.id);
  expect(importedEntity?.components?.MeshRenderer?.material?.baseColorTextureAssetId).toBe(
    texture.id,
  );
  expect(firstDocument.assetPayloads).toHaveLength(2);
  const modelPayload = firstDocument.assetPayloads.find((payload) => payload.assetId === asset.id)!;
  const texturePayload = firstDocument.assetPayloads.find(
    (payload) => payload.assetId === texture.id,
  )!;
  expect(modelPayload).toMatchObject({
    assetId: asset.id,
    mimeType: 'model/gltf-binary',
    encoding: 'base64',
  });
  expect(Buffer.from(modelPayload.data, 'base64')).toEqual(makeTriangleGlb());
  expect(texturePayload).toMatchObject({
    assetId: texture.id,
    mimeType: 'image/png',
    encoding: 'base64',
  });

  await page.locator('input[accept=".world,application/json"]').setInputFiles({
    name: 'round-trip.world',
    mimeType: 'application/json',
    buffer: Buffer.from(firstSave),
  });
  await expect(page.getByText('TriangleNode')).toBeVisible();
  const secondDocument = JSON.parse(await saveWorld()) as typeof firstDocument;
  expect(secondDocument.assets).toHaveLength(2);
  expect(secondDocument.assets.find((item) => item.kind === 'model')?.id).toBe(asset.id);
  expect(secondDocument.assets.find((item) => item.kind === 'texture')?.id).toBe(texture.id);
  expect(secondDocument.assetPayloads).toEqual(firstDocument.assetPayloads);
  const reopenedEntity = secondDocument.world.entities.find(
    (entity) => entity.components?.MeshRenderer?.assetId,
  );
  expect(reopenedEntity?.components?.MeshRenderer?.assetId).toBe(asset.id);
  expect(reopenedEntity?.components?.MeshRenderer?.material?.baseColorTextureAssetId).toBe(
    texture.id,
  );
  await page.waitForTimeout(250);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
