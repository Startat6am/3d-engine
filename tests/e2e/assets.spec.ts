import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function makeTriangleGlb(nodeNames = ['TriangleNode']): Buffer {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const normals = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  const uvs = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
  const binary = Buffer.concat([positions, normals, uvs, image]);
  const document = {
    asset: { version: '2.0', generator: 'editor-assets-e2e' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: normals.length },
      { buffer: 0, byteOffset: positions.length + normals.length, byteLength: uvs.length },
      {
        buffer: 0,
        byteOffset: positions.length + normals.length + uvs.length,
        byteLength: image.length,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
    ],
    images: [{ name: 'One pixel', mimeType: 'image/png', bufferView: 3 }],
    extensionsUsed: ['KHR_texture_transform'],
    extensionsRequired: ['KHR_texture_transform'],
    samplers: [{ magFilter: 9728, minFilter: 9985, wrapS: 33648, wrapT: 33071 }],
    textures: [{ source: 0, sampler: 0 }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: {
            index: 0,
            extensions: {
              KHR_texture_transform: {
                offset: [0.25, 0.5],
                rotation: Math.PI / 2,
                scale: [2, 3],
              },
            },
          },
          metallicRoughnessTexture: { index: 0 },
        },
        normalTexture: { index: 0 },
        occlusionTexture: { index: 0 },
        emissiveTexture: { index: 0 },
        emissiveFactor: [0.1, 0.2, 0.3],
      },
    ],
    meshes: [
      {
        name: 'Triangle',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }],
      },
    ],
    nodes: nodeNames.map((name, index) => ({
      name,
      mesh: 0,
      translation: [index * 2 - 1, 0, 0],
    })),
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
    const saveButton = menu.locator('.file-menu-content button').nth(2);
    await expect(saveButton).toBeVisible();
    await saveButton.click();
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
          MeshRenderer?: {
            assetId?: string;
            geometry?: { uvs?: number[] };
            material?: {
              baseColorTextureAssetId?: string;
              metallicRoughnessTextureAssetId?: string;
              normalTextureAssetId?: string;
              occlusionTextureAssetId?: string;
              emissiveTextureAssetId?: string;
              baseColorTextureSettings?: {
                sampler?: {
                  magFilter: number | null;
                  minFilter: number | null;
                  wrapS: number;
                  wrapT: number;
                };
                transform?: { offset: number[]; rotation: number; scale: number[] };
              };
            };
          };
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
  expect(importedEntity?.components?.MeshRenderer?.material?.baseColorTextureSettings).toEqual({
    sampler: { magFilter: 9728, minFilter: 9985, wrapS: 33648, wrapT: 33071 },
    transform: { offset: [0.25, 0.5], rotation: Math.PI / 2, scale: [2, 3] },
  });
  expect(importedEntity?.components?.MeshRenderer?.material).toMatchObject({
    metallicRoughnessTextureAssetId: texture.id,
    normalTextureAssetId: texture.id,
    occlusionTextureAssetId: texture.id,
    emissiveTextureAssetId: texture.id,
  });
  expect(importedEntity?.components?.MeshRenderer?.geometry?.uvs).toEqual([0, 0, 1, 0, 0, 1]);
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
  expect(reopenedEntity?.components?.MeshRenderer?.material?.baseColorTextureSettings).toEqual(
    importedEntity?.components?.MeshRenderer?.material?.baseColorTextureSettings,
  );
  expect(reopenedEntity?.components?.MeshRenderer?.material).toMatchObject({
    metallicRoughnessTextureAssetId: texture.id,
    normalTextureAssetId: texture.id,
    occlusionTextureAssetId: texture.id,
    emissiveTextureAssetId: texture.id,
  });
  expect(reopenedEntity?.components?.MeshRenderer?.geometry?.uvs).toEqual([0, 0, 1, 0, 0, 1]);
  // A tampered embedded texture payload must fail hash verification before
  // committing any of the staged world state.
  const tamperedDocument = JSON.parse(firstSave) as typeof firstDocument;
  const tamperedTexturePayload = tamperedDocument.assetPayloads.find(
    (payload) => payload.assetId === texture.id,
  )!;
  tamperedTexturePayload.data = Buffer.from('tampered image bytes').toString('base64');
  await page.locator('input[accept=".world,application/json"]').setInputFiles({
    name: 'tampered.world',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tamperedDocument)),
  });
  await page.getByRole('button', { name: /Console/ }).click();
  await expect(page.getByText('Could not open tampered.world', { exact: true })).toBeVisible();
  await expect(page.getByText(/Embedded asset payload hash mismatch/)).toBeVisible();
  await expect(page.getByText('TriangleNode')).toBeVisible();

  // The rejected load must leave the previous scene and its valid asset payloads intact.
  const afterRejectedLoad = JSON.parse(await saveWorld()) as typeof firstDocument;
  expect(afterRejectedLoad.assets.map((item) => item.id)).toContain(asset.id);
  expect(afterRejectedLoad.assets.map((item) => item.id)).toContain(texture.id);
  expect(afterRejectedLoad.assetPayloads).toEqual(firstDocument.assetPayloads);

  await page.waitForTimeout(250);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renderer releases uploaded texture resources when an imported object is removed', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const context = WebGL2RenderingContext.prototype;
    const deleteTexture = context.deleteTexture;
    Object.defineProperty(window, '__deletedTextureCount', { value: 0, writable: true });
    context.deleteTexture = function (texture: WebGLTexture | null) {
      (window as Window & { __deletedTextureCount: number }).__deletedTextureCount += 1;
      return deleteTexture.call(this, texture);
    };
  });

  await page.goto('/');
  const glbInput = page.locator('input[accept=".glb,model/gltf-binary"]');
  await glbInput.setInputFiles({
    name: 'lifecycle.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(),
  });
  await expect(page.getByText('TriangleNode')).toBeVisible();

  // Wait until the renderer has decoded and uploaded the embedded texture maps.
  await expect
    .poll(() => page.evaluate(() => document.querySelector('canvas')?.dataset.renderer))
    .toBe('webgl2');
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(page.getByText('TriangleNode')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __deletedTextureCount: number }).__deletedTextureCount,
      ),
    )
    .toBeGreaterThan(0);

  // A fresh import after final-lease disposal must decode/upload cleanly again.
  await glbInput.setInputFiles({
    name: 'lifecycle-again.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(),
  });
  await expect(page.getByText('TriangleNode')).toBeVisible();
  await page.waitForTimeout(300);
  expect(pageErrors).toEqual([]);
});

test('renderer keeps a shared texture alive until the final object lease is released', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const context = WebGL2RenderingContext.prototype;
    const deleteTexture = context.deleteTexture;
    Object.defineProperty(window, '__deletedTextureCount', { value: 0, writable: true });
    context.deleteTexture = function (texture: WebGLTexture | null) {
      (window as Window & { __deletedTextureCount: number }).__deletedTextureCount += 1;
      return deleteTexture.call(this, texture);
    };
  });

  await page.goto('/');
  const glbInput = page.locator('input[accept=".glb,model/gltf-binary"]');
  await glbInput.setInputFiles({
    name: 'shared-texture.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(['SharedTextureA', 'SharedTextureB']),
  });
  await expect(page.getByText('SharedTextureA')).toBeVisible();
  await expect(page.getByText('SharedTextureB')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('canvas')?.dataset.renderer))
    .toBe('webgl2');
  // Allow all five material texture channels to finish decoding and uploading.
  await page.waitForTimeout(350);

  await page.getByRole('button', { name: 'SharedTextureB' }).click();
  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(page.getByText('SharedTextureB')).toHaveCount(0);
  await expect(page.getByText('SharedTextureA')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __deletedTextureCount: number }).__deletedTextureCount,
      ),
    )
    .toBe(0);

  // Explicitly select the remaining object before the second removal.
  await page.getByRole('button', { name: 'SharedTextureA' }).click();
  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(page.getByText('SharedTextureA')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __deletedTextureCount: number }).__deletedTextureCount,
      ),
    )
    .toBeGreaterThan(0);
});

test('renderer restores its WebGL context and reuploads scene textures after context loss', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const texImage2D = prototype.texImage2D;
    const state = window as Window & { __textureUploadCount: number };
    state.__textureUploadCount = 0;
    prototype.texImage2D = function (...args: Parameters<typeof texImage2D>) {
      state.__textureUploadCount += 1;
      return texImage2D.apply(this, args);
    };
  });
  await page.goto('/');
  const glbInput = page.locator('input[accept=".glb,model/gltf-binary"]');
  await glbInput.setInputFiles({
    name: 'context-restore.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(),
  });
  await expect(page.getByText('TriangleNode')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __textureUploadCount: number }).__textureUploadCount,
      ),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(350);
  const uploadsBeforeLoss = await page.evaluate(
    () => (window as Window & { __textureUploadCount: number }).__textureUploadCount,
  );
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-renderer', 'webgl2');

  const supported = await page.evaluate(() => {
    const element = document.querySelector('canvas');
    const context = element?.getContext('webgl2');
    return Boolean(context?.getExtension('WEBGL_lose_context'));
  });
  test.skip(!supported, 'WEBGL_lose_context is unavailable in this browser');

  await page.evaluate(() => {
    const element = document.querySelector('canvas');
    const context = element?.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!element || !context || !extension)
      throw new Error('WebGL context-loss extension disappeared');

    const state = window as Window & {
      __webglContextEvents: string[];
      __webglLoseContextExtension: WEBGL_lose_context;
    };
    state.__webglContextEvents = [];
    state.__webglLoseContextExtension = extension;
    element.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        state.__webglContextEvents.push('lost');
      },
      { once: true },
    );
    element.addEventListener(
      'webglcontextrestored',
      () => state.__webglContextEvents.push('restored'),
      { once: true },
    );
    extension.loseContext();
  });

  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as Window & { __webglContextEvents: string[] }).__webglContextEvents.includes(
            'lost',
          ),
        ),
      { timeout: 5_000 },
    )
    .toBe(true);

  await page.evaluate(async () => {
    const state = window as Window & {
      __webglLoseContextExtension: WEBGL_lose_context;
    };
    // Let the browser finish dispatching the loss event before requesting restoration.
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    state.__webglLoseContextExtension.restoreContext();
  });

  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as Window & { __webglContextEvents: string[] }).__webglContextEvents.includes(
            'restored',
          ),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const context = document.querySelector('canvas')?.getContext('webgl2');
        return context ? context.isContextLost() : true;
      }),
    )
    .toBe(false);
  await expect(canvas).toHaveAttribute('data-renderer', 'webgl2');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __textureUploadCount: number }).__textureUploadCount,
      ),
    )
    .toBeGreaterThan(uploadsBeforeLoss);
  await expect(page.getByText('TriangleNode')).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
