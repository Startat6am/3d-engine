import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([length, payload, checksum]);
}

function makeSolidPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4 + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      pixels[pixel] = 45;
      pixels[pixel + 1] = 125;
      pixels[pixel + 2] = 210;
      pixels[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeMemoryGlb(vertexCount: number, textureSize: number): Buffer {
  const positions = Buffer.from(new Float32Array(vertexCount * 3).buffer);
  const values = new Float32Array(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    values[offset] = (vertex % 3) * 0.5;
    values[offset + 1] = Math.floor(vertex / 3) % 2;
  }
  const image = makeSolidPng(textureSize, textureSize);
  const binary = Buffer.concat([positions, image]);
  const document = {
    asset: { version: '2.0', generator: 'Choreon browser memory benchmark' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: image.length },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3' }],
    images: [{ name: 'Memory benchmark texture', mimeType: 'image/png', bufferView: 1 }],
    textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ name: 'BrowserMemoryFixture', mesh: 0 }],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binaryChunk = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
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

test('browser memory benchmark records tab memory and WebGL allocation lifecycle', async ({
  page,
}) => {
  const vertexCount = 300_000;
  const textureSize = 2048;
  const expectedTextureBytes = textureSize * textureSize * 4;

  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      },
    });
  });

  await page.addInitScript(() => {
    const state = {
      liveBufferBytes: 0,
      peakBufferBytes: 0,
      liveTextureBytes: 0,
      peakTextureBytes: 0,
    };
    const bufferSizes = new WeakMap<WebGLBuffer, number>();
    const textureSizes = new WeakMap<WebGLTexture, number>();
    Object.defineProperty(window, '__webglMemory', { value: state });

    const prototype = WebGL2RenderingContext.prototype;
    const originalBufferData = prototype.bufferData;
    prototype.bufferData = function (target, source, usage) {
      const binding =
        target === this.ARRAY_BUFFER
          ? this.ARRAY_BUFFER_BINDING
          : target === this.ELEMENT_ARRAY_BUFFER
            ? this.ELEMENT_ARRAY_BUFFER_BINDING
            : null;
      const buffer = binding ? (this.getParameter(binding) as WebGLBuffer | null) : null;
      if (buffer) {
        const previous = bufferSizes.get(buffer) ?? 0;
        const size =
          typeof source === 'number'
            ? source
            : source instanceof ArrayBuffer
              ? source.byteLength
              : source.byteLength;
        state.liveBufferBytes += size - previous;
        state.peakBufferBytes = Math.max(state.peakBufferBytes, state.liveBufferBytes);
        bufferSizes.set(buffer, size);
      }
      return originalBufferData.call(this, target, source, usage);
    };
    const originalDeleteBuffer = prototype.deleteBuffer;
    prototype.deleteBuffer = function (buffer) {
      if (buffer) {
        state.liveBufferBytes -= bufferSizes.get(buffer) ?? 0;
        bufferSizes.delete(buffer);
      }
      return originalDeleteBuffer.call(this, buffer);
    };

    const originalTexImage2D = prototype.texImage2D;
    prototype.texImage2D = function (...args) {
      const texture = this.getParameter(this.TEXTURE_BINDING_2D) as WebGLTexture | null;
      if (texture) {
        const source =
          args.length === 9
            ? null
            : (args[5] as {
                width?: number;
                height?: number;
                videoWidth?: number;
                videoHeight?: number;
              });
        const width =
          args.length === 9 ? Number(args[3]) : Number(source?.width ?? source?.videoWidth ?? 0);
        const height =
          args.length === 9 ? Number(args[4]) : Number(source?.height ?? source?.videoHeight ?? 0);
        const size = width * height * 4;
        const previous = textureSizes.get(texture) ?? 0;
        state.liveTextureBytes += size - previous;
        state.peakTextureBytes = Math.max(state.peakTextureBytes, state.liveTextureBytes);
        textureSizes.set(texture, size);
      }
      return Reflect.apply(originalTexImage2D, this, args);
    };
    const originalDeleteTexture = prototype.deleteTexture;
    prototype.deleteTexture = function (texture) {
      if (texture) {
        state.liveTextureBytes -= textureSizes.get(texture) ?? 0;
        textureSizes.delete(texture);
      }
      return originalDeleteTexture.call(this, texture);
    };
  });

  await page.goto('/');
  const baseline = await page.evaluate(async () => {
    const api = performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    };
    if (!crossOriginIsolated || !api.measureUserAgentSpecificMemory) {
      throw new Error('Chromium user-agent memory measurement requires cross-origin isolation');
    }
    return {
      userAgentBytes: (await api.measureUserAgentSpecificMemory()).bytes,
      gpu: (
        window as Window & {
          __webglMemory: { liveBufferBytes: number; liveTextureBytes: number };
        }
      ).__webglMemory,
    };
  });

  await page.locator('input[accept=".glb,model/gltf-binary"]').setInputFiles({
    name: 'browser-memory.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeMemoryGlb(vertexCount, textureSize),
  });
  await expect(page.getByText('BrowserMemoryFixture')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __webglMemory: { liveTextureBytes: number } }).__webglMemory
            .liveTextureBytes,
      ),
    )
    .toBeGreaterThanOrEqual(expectedTextureBytes);

  const retained = await page.evaluate(async () => {
    const api = performance as Performance & {
      measureUserAgentSpecificMemory: () => Promise<{ bytes: number }>;
    };
    return {
      userAgentBytes: (await api.measureUserAgentSpecificMemory()).bytes,
      gpu: (
        window as Window & {
          __webglMemory: {
            liveBufferBytes: number;
            peakBufferBytes: number;
            liveTextureBytes: number;
            peakTextureBytes: number;
          };
        }
      ).__webglMemory,
    };
  });

  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(page.getByText('BrowserMemoryFixture')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __webglMemory: { liveTextureBytes: number } }).__webglMemory
            .liveTextureBytes,
      ),
    )
    .toBeLessThanOrEqual(baseline.gpu.liveTextureBytes);
  await page.waitForTimeout(250);

  const released = await page.evaluate(async () => {
    const api = performance as Performance & {
      measureUserAgentSpecificMemory: () => Promise<{ bytes: number }>;
    };
    return {
      userAgentBytes: (await api.measureUserAgentSpecificMemory()).bytes,
      gpu: (
        window as Window & {
          __webglMemory: {
            liveBufferBytes: number;
            peakBufferBytes: number;
            liveTextureBytes: number;
            peakTextureBytes: number;
          };
        }
      ).__webglMemory,
    };
  });

  console.warn(
    '[browser-memory-benchmark]',
    JSON.stringify({
      fixture: { vertexCount, textureSize, expectedTextureBytes },
      userAgentMemoryBytes: {
        baseline: baseline.userAgentBytes,
        retained: retained.userAgentBytes,
        released: released.userAgentBytes,
      },
      webglBytes: { retained: retained.gpu, released: released.gpu },
    }),
  );
  expect(retained.gpu.peakBufferBytes).toBeGreaterThanOrEqual(vertexCount * 3 * 4);
  expect(retained.gpu.peakTextureBytes).toBeGreaterThanOrEqual(expectedTextureBytes);
  expect(released.gpu.liveTextureBytes).toBeLessThanOrEqual(baseline.gpu.liveTextureBytes);
  expect(released.gpu.liveBufferBytes).toBeLessThanOrEqual(baseline.gpu.liveBufferBytes);

  await page.locator('input[accept=".glb,model/gltf-binary"]').setInputFiles({
    name: 'browser-memory-repeat.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeMemoryGlb(vertexCount, textureSize),
  });
  await expect(page.getByText('BrowserMemoryFixture')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __webglMemory: { liveTextureBytes: number } }).__webglMemory
            .liveTextureBytes,
      ),
    )
    .toBeGreaterThanOrEqual(expectedTextureBytes);
  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(page.getByText('BrowserMemoryFixture')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __webglMemory: { liveTextureBytes: number } }).__webglMemory
            .liveTextureBytes,
      ),
    )
    .toBeLessThanOrEqual(baseline.gpu.liveTextureBytes);
});
