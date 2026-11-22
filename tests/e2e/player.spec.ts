import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

function makeAnimatedCharacterGlb(): Buffer {
  const binary = Buffer.alloc(192);
  const floats = (offset: number, values: number[]) =>
    values.forEach((value, index) => binary.writeFloatLE(value, offset + index * 4));
  floats(0, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  for (let index = 0; index < 12; index++) binary.writeUInt8(0, 36 + index);
  floats(48, Array.from({ length: 3 }, () => [1, 0, 0, 0]).flat());
  floats(96, [0, 1]);
  floats(104, [0, 0, 0, 1, 0, 0]);
  floats(128, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const document = {
    asset: { version: '2.0', generator: 'player-animation-e2e' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 12 },
      { buffer: 0, byteOffset: 48, byteLength: 48 },
      { buffer: 0, byteOffset: 96, byteLength: 8 },
      { buffer: 0, byteOffset: 104, byteLength: 24 },
      { buffer: 0, byteOffset: 128, byteLength: 64 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 5, componentType: 5126, count: 1, type: 'MAT4' },
    ],
    meshes: [
      {
        name: 'Animated triangle',
        primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }],
      },
    ],
    nodes: [{ name: 'Root joint' }, { name: 'Character mesh', mesh: 0, skin: 0 }],
    skins: [{ name: 'Character skin', joints: [0], inverseBindMatrices: 5 }],
    animations: [
      {
        name: 'Move root',
        samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]);
}

test('player renders the preloaded voxel test scene through WebGL2', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, '__engineDrawCalls', { value: 0, writable: true });
    const original = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (mode, count, type, offset) {
      const target = window as unknown as { __engineDrawCalls: number };
      target.__engineDrawCalls += 1;
      return original.call(this, mode, count, type, offset);
    };
  });

  await page.goto('http://127.0.0.1:5174');
  const canvas = page.locator('#player');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#project-status')).toContainText('Voxel test scene ready');
  const fps = page.getByLabel('Frames per second');
  await expect.poll(() => fps.textContent()).toMatch(/^FPS \d+$/);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __engineDrawCalls: number }).__engineDrawCalls),
    )
    .toBeGreaterThanOrEqual(4);
  const renderOutput = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return { hasWebGl2: false, litPixels: 0 };
    const gl = element.getContext('webgl2');
    if (!gl) return { hasWebGl2: false, litPixels: 0 };
    const pixels = new Uint8Array(element.width * element.height * 4);
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let litPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 21 || pixels[index + 1] !== 26 || pixels[index + 2] !== 35)
        litPixels += 1;
    }
    return { hasWebGl2: true, litPixels };
  });
  expect(renderOutput.hasWebGl2).toBe(true);
  expect(renderOutput.litPixels).toBeGreaterThan(500);
  expect(pageErrors).toEqual([]);
});

test('player shutdown releases renderer GPU resources and stops its frame loop', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as {
      __deletedBuffers: number;
      __deletedPrograms: number;
      __drawCalls: number;
    };
    state.__deletedBuffers = 0;
    state.__deletedPrograms = 0;
    state.__drawCalls = 0;

    const deleteBuffer = WebGL2RenderingContext.prototype.deleteBuffer;
    WebGL2RenderingContext.prototype.deleteBuffer = function (buffer) {
      state.__deletedBuffers += 1;
      return deleteBuffer.call(this, buffer);
    };
    const deleteProgram = WebGL2RenderingContext.prototype.deleteProgram;
    WebGL2RenderingContext.prototype.deleteProgram = function (program) {
      state.__deletedPrograms += 1;
      return deleteProgram.call(this, program);
    };
    const drawElements = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (mode, count, type, offset) {
      state.__drawCalls += 1;
      return drawElements.call(this, mode, count, type, offset);
    };
  });

  await page.goto('http://127.0.0.1:5174');
  await expect(page.locator('#project-status')).toContainText('Voxel test scene ready');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __playerSampleChunkLoads: number }).__playerSampleChunkLoads,
      ),
    )
    .toBeGreaterThan(20);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __drawCalls: number }).__drawCalls))
    .toBeGreaterThanOrEqual(4);

  const beforeDispose = await page.evaluate(() => {
    const state = window as unknown as {
      __deletedBuffers: number;
      __deletedPrograms: number;
    };
    return { ...state };
  });

  // Exercise the same pagehide handler used by a real browser navigation while
  // keeping the page alive long enough to observe WebGL resource deletion.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __deletedBuffers: number }).__deletedBuffers),
    )
    .toBeGreaterThan(beforeDispose.__deletedBuffers);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __deletedPrograms: number }).__deletedPrograms),
    )
    .toBeGreaterThan(beforeDispose.__deletedPrograms);

  // Let any frame already in flight when pagehide was dispatched finish, then
  // prove that the cancelled loop does not schedule another frame.
  await page.waitForTimeout(100);
  const settledDrawCalls = await page.evaluate(
    () => (window as unknown as { __drawCalls: number }).__drawCalls,
  );
  await page.waitForTimeout(100);
  const afterDisposeDrawCalls = await page.evaluate(
    () => (window as unknown as { __drawCalls: number }).__drawCalls,
  );
  expect(afterDisposeDrawCalls).toBe(settledDrawCalls);
  expect(pageErrors).toEqual([]);
});

test('renderer deforms a skinned mesh when its CPU joint palette changes', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174/skinning-test.html');
  await expect(page.locator('#status')).toContainText('ready:');
  const before = await page.evaluate(() => {
    const state = window as Window & {
      __skinningInitial: { checksum: number; visiblePixels: number };
    };
    return state.__skinningInitial;
  });
  expect(before.visiblePixels).toBeGreaterThan(100);
  const after = await page.evaluate(() => {
    const state = window as Window & {
      __skinningMove: () => { checksum: number; visiblePixels: number };
    };
    return state.__skinningMove();
  });
  expect(after.visiblePixels).toBeGreaterThan(100);
  expect(after.checksum).not.toBe(before.checksum);
});

test('Player imports and plays a skinned GLB animation through the renderer', async ({ page }) => {
  const glb = makeAnimatedCharacterGlb();
  const digest = createHash('sha256').update(glb).digest('hex');
  const assetId = 'asset:model:animated-character';
  const assetUri = `assets/sha256/${digest.slice(0, 2)}/${digest}.glb`;
  const manifest = {
    format: 'universal-3d-world',
    schemaVersion: '1.0.0',
    engineVersion: '0.1.0',
    world: {
      id: 'world:animated-character',
      name: 'Animated Character',
      settings: {},
      entities: [
        {
          id: 'entity:animated-character',
          components: {
            Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            MeshRenderer: { primitive: 'GLB', assetId },
          },
        },
      ],
    },
    assets: [
      {
        id: assetId,
        name: 'Animated Character',
        kind: 'model',
        uri: assetUri,
        contentHash: `sha256:${digest}`,
        importer: { id: 'engine.gltf.glb', version: '0.1.0', settings: {} },
        dependencies: [],
        metadata: { mimeType: 'model/gltf-binary' },
      },
    ],
    extensions: {
      'com.choreon.voxel-world': {
        schemaVersion: 1,
        settings: { voxelSize: 1, chunkDimensions: { x: 16, y: 16, z: 16 } },
        chunks: [],
      },
    },
  };
  const entries = [
    { path: 'worlds/main.world', bytes: Array.from(Buffer.from(JSON.stringify(manifest))) },
    { path: assetUri, bytes: Array.from(glb) },
  ];
  await page.addInitScript((fileEntries) => {
    const files = new Map(fileEntries.map((entry) => [entry.path, new Uint8Array(entry.bytes)]));
    const directories = new Set<string>(['']);
    for (const path of files.keys()) {
      const parts = path.split('/');
      parts.pop();
      let prefix = '';
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        directories.add(prefix);
      }
    }
    const makeDirectory = (prefix: string) => ({
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (!directories.has(path)) {
          if (!options?.create) throw new DOMException('Directory not found', 'NotFoundError');
          directories.add(path);
        }
        return makeDirectory(path);
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (!files.has(path)) {
          if (!options?.create) throw new DOMException('File not found', 'NotFoundError');
          files.set(path, new Uint8Array());
        }
        return {
          async getFile() {
            return new File([files.get(path)!.slice().buffer as ArrayBuffer], name);
          },
          async createWritable() {
            let pending = new Uint8Array();
            return {
              async write(data: Uint8Array) {
                pending = new Uint8Array(data);
              },
              async close() {
                files.set(path, pending);
              },
              async abort() {},
            };
          },
        };
      },
    });
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => makeDirectory(''),
    });
  }, entries);

  await page.goto('http://127.0.0.1:5174');
  await expect(page.locator('#project-status')).toContainText('Voxel test scene ready');
  await page.locator('#load-project').click();
  await expect(page.locator('#project-status')).toContainText('Loaded “Animated Character”');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __playerActiveAnimations?: number }).__playerActiveAnimations,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playerAnimationFrames?: number }).__playerAnimationFrames ?? 0,
      ),
    )
    .toBeGreaterThan(5);
  const firstPaletteX = await page.evaluate(
    () => (window as Window & { __playerSkinPaletteX?: number }).__playerSkinPaletteX ?? 0,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __playerSkinPaletteX?: number }).__playerSkinPaletteX ?? 0,
      ),
    )
    .not.toBe(firstPaletteX);
  await expect(page.locator('#player')).toBeVisible();
});

test('Player activates Web Audio from a user gesture and starts a spatial voice', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174');
  await expect(page.locator('#audio-test')).toHaveText('Play spatial audio test');
  expect(
    await page.evaluate(
      () => (window as Window & { __playerAudioActive?: boolean }).__playerAudioActive,
    ),
  ).toBeUndefined();
  await page.locator('#audio-test').click();
  await expect(page.locator('#audio-test')).toHaveText('Spatial audio playing');
  const audio = await page.evaluate(() => {
    const state = window as Window & {
      __playerAudioActive?: boolean;
      __playerAudioVoices?: number;
      __playerAudioSpatialization?: string;
      __playerAudioContextState?: string;
      __playerAudioListenerPosition?: readonly [number, number, number];
    };
    return {
      active: state.__playerAudioActive,
      voices: state.__playerAudioVoices,
      spatialization: state.__playerAudioSpatialization,
      contextState: state.__playerAudioContextState,
      listenerPosition: state.__playerAudioListenerPosition,
    };
  });
  expect(audio.active).toBe(true);
  expect(audio.voices).toBe(1);
  expect(['HRTF', 'equalpower']).toContain(audio.spatialization);
  expect(audio.contextState).toBe('running');
  expect(audio.listenerPosition).toHaveLength(3);
  const initialListenerPosition = audio.listenerPosition;
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playerAudioListenerPosition?: readonly [number, number, number] })
            .__playerAudioListenerPosition,
      ),
    )
    .not.toEqual(initialListenerPosition);
});
