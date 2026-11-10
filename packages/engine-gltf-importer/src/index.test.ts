import { describe, expect, it } from 'vitest';
import { GlbImportError, GlbImporter } from './index.js';

function makeGlb(options: { indices?: number[]; mode?: number; normals?: boolean; imageBytes?: number[] } = {}): ArrayBuffer {
  const binaryParts: Uint8Array[] = [];
  const views: { byteOffset: number; byteLength: number }[] = [];
  const addFloats = (values: number[]) => {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    views.push({ byteOffset: binaryParts.reduce((sum, part) => sum + part.length, 0), byteLength: bytes.length });
    binaryParts.push(bytes);
    return views.length - 1;
  };
  const positions = addFloats([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = options.normals === false ? undefined : addFloats([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  let indices: number | undefined;
  if (options.indices) {
    const bytes = new Uint8Array(options.indices);
    views.push({ byteOffset: binaryParts.reduce((sum, part) => sum + part.length, 0), byteLength: bytes.length });
    binaryParts.push(bytes);
    indices = views.length - 1;
  }
  let imageView: number | undefined;
  if (options.imageBytes) {
    const bytes = Uint8Array.from(options.imageBytes);
    views.push({ byteOffset: binaryParts.reduce((sum, part) => sum + part.length, 0), byteLength: bytes.length });
    binaryParts.push(bytes);
    imageView = views.length - 1;
  }
  const binaryLength = binaryParts.reduce((sum, part) => sum + part.length, 0);
  const binary = new Uint8Array(binaryLength);
  let cursor = 0;
  for (const part of binaryParts) { binary.set(part, cursor); cursor += part.length; }
  const json = {
    asset: { version: '2.0', generator: 'unit-test' },
    buffers: [{ byteLength: binaryLength }],
    bufferViews: views.map((entry) => ({ ...entry, buffer: 0 })),
    accessors: [
      { bufferView: positions, componentType: 5126, count: 3, type: 'VEC3' },
      ...(normals === undefined ? [] : [{ bufferView: normals, componentType: 5126, count: 3, type: 'VEC3' }]),
      ...(indices === undefined ? [] : [{ bufferView: indices, componentType: 5121, count: options.indices!.length, type: 'SCALAR' }]),
    ],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0, ...(normals === undefined ? {} : { NORMAL: 1 }) }, ...(indices === undefined ? {} : { indices: normals === undefined ? 1 : 2 }), ...(options.mode === undefined ? {} : { mode: options.mode }) }] }],
    materials: [{ name: 'Paint', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1], metallicFactor: 0.3, roughnessFactor: 0.8, ...(imageView === undefined ? {} : { baseColorTexture: { index: 0 } }) } }],
    ...(imageView === undefined ? {} : {
      images: [{ name: 'Embedded albedo', mimeType: 'image/png', bufferView: imageView }],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 }],
      textures: [{ source: 0, sampler: 0 }],
    }),
    nodes: [{ mesh: 0, translation: [2, 0, 0] }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binLength = Math.ceil(binary.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const output = new ArrayBuffer(total);
  const header = new DataView(output);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, jsonBytes.length).set(jsonBytes);
  new Uint8Array(output, 20 + jsonBytes.length, jsonLength - jsonBytes.length).fill(0x20);
  const binHeader = 20 + jsonLength;
  header.setUint32(binHeader, binLength, true);
  header.setUint32(binHeader + 4, 0x004e4942, true);
  new Uint8Array(output, binHeader + 8, binary.length).set(binary);
  return output;
}

const context = { uri: 'models/triangle.glb', settings: {}, signal: new AbortController().signal };

describe('GlbImporter', () => {
  it('imports GLB positions, normals, indices, nodes and PBR material factors', async () => {
    const result = await new GlbImporter().import(makeGlb({ indices: [0, 1, 2] }), context);
    expect(result.kind).toBe('model');
    expect(result.data.meshes[0]?.primitives[0]?.mesh.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(result.data.meshes[0]?.primitives[0]?.mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(result.data.materials[0]?.metallicFactor).toBe(0.3);
    expect(result.data.materials[0]?.roughnessFactor).toBe(0.8);
    expect(result.data.nodes[0]?.translation).toEqual([2, 0, 0]);
    expect(result.metadata.primitiveCount).toBe(1);
  });

  it('retains embedded image bytes and resolves texture sampler/material references', async () => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10];
    const result = await new GlbImporter().import(makeGlb({ imageBytes: bytes }), context);
    expect(result.data.images).toHaveLength(1);
    expect(result.data.images[0]?.mimeType).toBe('image/png');
    expect(Array.from(result.data.images[0]!.data)).toEqual(bytes);
    expect(result.data.samplers[0]).toEqual({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 });
    expect(result.data.textures[0]).toMatchObject({ source: 0, sampler: 0, mimeType: 'image/png', embedded: true });
    expect(result.data.materials[0]?.baseColorTexture).toBe(0);
  });

  it('generates vertex normals when NORMAL is absent', async () => {
    const result = await new GlbImporter().import(makeGlb({ normals: false }), context);
    expect(Array.from(result.data.meshes[0]!.primitives[0]!.mesh.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('rejects malformed headers and unsupported primitive modes', async () => {
    await expect(new GlbImporter().import(new ArrayBuffer(8), context)).rejects.toMatchObject({ code: 'INVALID_GLB' });
    await expect(new GlbImporter().import(makeGlb({ mode: 1 }), context)).rejects.toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
  });

  it('rejects out-of-range primitive indices', async () => {
    await expect(new GlbImporter().import(makeGlb({ indices: [0, 1, 9] }), context)).rejects.toMatchObject({ code: 'INVALID_ACCESSOR' });
  });

  it('honors an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new GlbImporter().import(makeGlb(), { ...context, signal: controller.signal }))
      .rejects.toBeInstanceOf(GlbImportError);
  });
});
