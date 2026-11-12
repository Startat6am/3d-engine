import { MeshoptEncoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { GlbImportError, GlbImporter } from './index.js';

function makeGlb(
  options: {
    indices?: number[];
    mode?: number;
    normals?: boolean;
    imageBytes?: number[];
    uvs?: number[];
    allTextureChannels?: boolean;
    nodeMatrix?: number[];
  } = {},
): ArrayBuffer {
  const binaryParts: Uint8Array[] = [];
  const views: { byteOffset: number; byteLength: number }[] = [];
  const addFloats = (values: number[]) => {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    views.push({
      byteOffset: binaryParts.reduce((sum, part) => sum + part.length, 0),
      byteLength: bytes.length,
    });
    binaryParts.push(bytes);
    return views.length - 1;
  };
  const positions = addFloats([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = options.normals === false ? undefined : addFloats([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = options.uvs ? addFloats(options.uvs) : undefined;
  let indices: number | undefined;
  if (options.indices) {
    const bytes = new Uint8Array(options.indices);
    views.push({
      byteOffset: binaryParts.reduce((sum, part) => sum + part.length, 0),
      byteLength: bytes.length,
    });
    binaryParts.push(bytes);
    indices = views.length - 1;
  }
  let imageView: number | undefined;
  if (options.imageBytes) {
    const bytes = Uint8Array.from(options.imageBytes);
    views.push({
      byteOffset: binaryParts.reduce((sum, part) => sum + part.length, 0),
      byteLength: bytes.length,
    });
    binaryParts.push(bytes);
    imageView = views.length - 1;
  }
  const binaryLength = binaryParts.reduce((sum, part) => sum + part.length, 0);
  const binary = new Uint8Array(binaryLength);
  let cursor = 0;
  for (const part of binaryParts) {
    binary.set(part, cursor);
    cursor += part.length;
  }
  const json = {
    asset: { version: '2.0', generator: 'unit-test' },
    buffers: [{ byteLength: binaryLength }],
    bufferViews: views.map((entry) => ({ ...entry, buffer: 0 })),
    accessors: [
      { bufferView: positions, componentType: 5126, count: 3, type: 'VEC3' },
      ...(normals === undefined
        ? []
        : [{ bufferView: normals, componentType: 5126, count: 3, type: 'VEC3' }]),
      ...(uvs === undefined
        ? []
        : [{ bufferView: uvs, componentType: 5126, count: 3, type: 'VEC2' }]),
      ...(indices === undefined
        ? []
        : [
            {
              bufferView: indices,
              componentType: 5121,
              count: options.indices!.length,
              type: 'SCALAR',
            },
          ]),
    ],
    meshes: [
      {
        name: 'Triangle',
        primitives: [
          {
            attributes: {
              POSITION: 0,
              ...(normals === undefined ? {} : { NORMAL: 1 }),
              ...(uvs === undefined ? {} : { TEXCOORD_0: normals === undefined ? 1 : 2 }),
            },
            ...(indices === undefined ? {} : { indices: normals === undefined ? 1 : 2 }),
            ...(imageView === undefined ? {} : { material: 0 }),
            ...(options.mode === undefined ? {} : { mode: options.mode }),
          },
        ],
      },
    ],
    materials: [
      {
        name: 'Paint',
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.4, 0.6, 1],
          metallicFactor: 0.3,
          roughnessFactor: 0.8,
          ...(imageView === undefined
            ? {}
            : {
                baseColorTexture: { index: 0 },
                ...(options.allTextureChannels ? { metallicRoughnessTexture: { index: 0 } } : {}),
              }),
        },
        ...(imageView === undefined || !options.allTextureChannels
          ? {}
          : {
              normalTexture: { index: 0 },
              occlusionTexture: { index: 0 },
              emissiveTexture: { index: 0 },
            }),
      },
    ],
    ...(imageView === undefined
      ? {}
      : {
          images: [{ name: 'Embedded albedo', mimeType: 'image/png', bufferView: imageView }],
          samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 }],
          textures: [{ source: 0, sampler: 0 }],
        }),
    nodes: [
      {
        mesh: 0,
        ...(options.nodeMatrix ? { matrix: options.nodeMatrix } : { translation: [2, 0, 0] }),
      },
    ],
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

function makeInterleavedGlb(): ArrayBuffer {
  const binary = new Uint8Array(72);
  const view = new DataView(binary.buffer);
  const vertices = [
    [0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [0, 1, 0, 0, 0, 1],
  ];
  vertices.forEach((vertex, index) =>
    vertex.forEach((value, component) => view.setFloat32(index * 24 + component * 4, value, true)),
  );
  const root = {
    asset: { version: '2.0', generator: 'interleaved-fixture' },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72, byteStride: 24 }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(root));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binary.byteLength;
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
  header.setUint32(binHeader, binary.byteLength, true);
  header.setUint32(binHeader + 4, 0x004e4942, true);
  new Uint8Array(output, binHeader + 8).set(binary);
  return output;
}

type MutableGlbJson = {
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  accessors?: { count: number }[];
  bufferViews?: { byteOffset?: number }[];
  buffers?: { byteLength: number }[];
  materials?: {
    pbrMetallicRoughness?: {
      baseColorTexture?: {
        extensions?: {
          KHR_texture_transform?: {
            offset?: number[];
            rotation?: number;
            scale?: number[];
            texCoord?: number;
          };
        };
      };
    };
  }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
};

function rewriteGlbJson(source: ArrayBuffer, update: (root: MutableGlbJson) => void): ArrayBuffer {
  const input = new DataView(source);
  const jsonLength = input.getUint32(12, true);
  const json = new TextDecoder().decode(new Uint8Array(source, 20, jsonLength)).trimEnd();
  const root = JSON.parse(json) as MutableGlbJson;
  update(root);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(root));
  const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binHeader = 20 + input.getUint32(12, true) + 8;
  const binLength = input.getUint32(binHeader - 8, true);
  const binary = new Uint8Array(source, binHeader, binLength);
  const paddedBinLength = Math.ceil(binLength / 4) * 4;
  const total = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
  const output = new ArrayBuffer(total);
  const header = new DataView(output);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, paddedJsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, jsonBytes.length).set(jsonBytes);
  new Uint8Array(output, 20 + jsonBytes.length, paddedJsonLength - jsonBytes.length).fill(0x20);
  const nextBinHeader = 20 + paddedJsonLength;
  header.setUint32(nextBinHeader, paddedBinLength, true);
  header.setUint32(nextBinHeader + 4, 0x004e4942, true);
  new Uint8Array(output, nextBinHeader + 8).set(binary);
  return output;
}

const context = { uri: 'models/triangle.glb', settings: {}, signal: new AbortController().signal };

async function makeMeshoptGlb(): Promise<ArrayBuffer> {
  await MeshoptEncoder.ready;
  const positions = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const indices = new Uint8Array(new Uint16Array([0, 1, 2]).buffer);
  const encodedPositions = MeshoptEncoder.encodeGltfBuffer(positions, 3, 12, 'ATTRIBUTES');
  const encodedIndices = MeshoptEncoder.encodeGltfBuffer(indices, 3, 2, 'TRIANGLES');
  const binary = new Uint8Array(encodedPositions.length + encodedIndices.length);
  binary.set(encodedPositions);
  binary.set(encodedIndices, encodedPositions.length);
  const document = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression'],
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [
      { byteLength: binary.length },
      {
        byteLength: positions.length + indices.length,
        extensions: { EXT_meshopt_compression: { fallback: true } },
      },
    ],
    bufferViews: [
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: positions.length,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: 0,
            byteLength: encodedPositions.length,
            byteStride: 12,
            count: 3,
            mode: 'ATTRIBUTES',
          },
        },
      },
      {
        buffer: 1,
        byteOffset: positions.length,
        byteLength: indices.length,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: encodedPositions.length,
            byteLength: encodedIndices.length,
            byteStride: 2,
            count: 3,
            mode: 'TRIANGLES',
          },
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(binary.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const output = new ArrayBuffer(total);
  const header = new DataView(output);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, json.length).set(json);
  new Uint8Array(output, 20 + json.length, jsonLength - json.length).fill(0x20);
  const binHeader = 20 + jsonLength;
  header.setUint32(binHeader, binLength, true);
  header.setUint32(binHeader + 4, 0x004e4942, true);
  new Uint8Array(output, binHeader + 8, binary.length).set(binary);
  return output;
}

describe('GlbImporter', () => {
  it('decodes required EXT_meshopt_compression buffers', async () => {
    const result = await new GlbImporter().import(await makeMeshoptGlb(), context);
    expect(result.data.meshes[0]?.primitives[0]?.mesh.positions).toEqual(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    );
    expect(result.data.meshes[0]?.primitives[0]?.mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });
  it('rejects meshopt expansion before allocating an oversized decoded BIN buffer', async () => {
    await expect(
      new GlbImporter().import(await makeMeshoptGlb(), {
        ...context,
        settings: { maxDecodedBufferBytes: 8 },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('reports deterministic import size and phase diagnostics', async () => {
    const result = await new GlbImporter().import(makeGlb({ indices: [0, 1, 2] }), context);
    expect(result.metadata).toMatchObject({
      format: 'glb',
      sourceBytes: expect.any(Number),
      geometryBytes: expect.any(Number),
      textureBytes: 0,
      vertexCount: 3,
      triangleCount: 1,
      parseMs: expect.any(Number),
      decodeMs: expect.any(Number),
      buildMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
  });

  it('rejects files and geometry that exceed configurable import budgets', async () => {
    const source = makeGlb({ indices: [0, 1, 2] });
    await expect(
      new GlbImporter().import(source, { ...context, settings: { maxSourceBytes: 16 } }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(
      new GlbImporter().import(source, { ...context, settings: { maxVertices: 2 } }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(
      new GlbImporter().import(source, { ...context, settings: { maxGeometryBytes: 8 } }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('imports GLB positions, normals, indices, nodes and PBR material factors', async () => {
    const result = await new GlbImporter().import(makeGlb({ indices: [0, 1, 2] }), context);
    expect(result.kind).toBe('model');
    expect(result.data.meshes[0]?.primitives[0]?.mesh.positions).toEqual(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    );
    expect(result.data.meshes[0]?.primitives[0]?.mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(result.data.materials[0]?.metallicFactor).toBe(0.3);
    expect(result.data.materials[0]?.roughnessFactor).toBe(0.8);
    expect(result.data.nodes[0]?.translation).toEqual([2, 0, 0]);
    expect(result.metadata.primitiveCount).toBe(1);
  });

  it('imports TEXCOORD_0 and exposes every supported embedded PBR texture channel', async () => {
    const result = await new GlbImporter().import(
      makeGlb({
        imageBytes: [1, 2, 3, 4],
        uvs: [0, 0, 1, 0, 0, 1],
        allTextureChannels: true,
      }),
      context,
    );
    const mesh = result.data.meshes[0]!.primitives[0]!.mesh;
    expect(mesh.uvs).toEqual(new Float32Array([0, 0, 1, 0, 0, 1]));
    expect(result.data.materials[0]).toMatchObject({
      baseColorTexture: 0,
      metallicRoughnessTexture: 0,
      normalTexture: 0,
      occlusionTexture: 0,
      emissiveTexture: 0,
    });
  });

  it('rejects textured materials when TEXCOORD_0 is absent', async () => {
    await expect(
      new GlbImporter().import(makeGlb({ imageBytes: [1, 2, 3, 4] }), context),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
  });

  it('reads interleaved POSITION and NORMAL accessors using byteStride and accessor byteOffset', async () => {
    const result = await new GlbImporter().import(makeInterleavedGlb(), context);
    const mesh = result.data.meshes[0]!.primitives[0]!.mesh;
    expect(mesh.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(mesh.normals).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  });

  it('imports KHR_texture_transform and required declarations with sampler settings', async () => {
    const glb = rewriteGlbJson(
      makeGlb({ imageBytes: [1, 2, 3, 4], uvs: [0, 0, 1, 0, 0, 1] }),
      (root) => {
        root.extensionsUsed = ['KHR_texture_transform'];
        root.extensionsRequired = ['KHR_texture_transform'];
        root.samplers![0] = { magFilter: 9728, minFilter: 9985, wrapS: 33648, wrapT: 33071 };
        root.materials![0]!.pbrMetallicRoughness!.baseColorTexture!.extensions = {
          KHR_texture_transform: { offset: [0.25, 0.5], rotation: Math.PI / 2, scale: [2, 3] },
        };
      },
    );
    const result = await new GlbImporter().import(glb, context);
    expect(result.data.samplers[0]).toEqual({
      magFilter: 9728,
      minFilter: 9985,
      wrapS: 33648,
      wrapT: 33071,
    });
    expect(result.data.materials[0]?.textureTransforms?.baseColor).toEqual({
      offset: [0.25, 0.5],
      rotation: Math.PI / 2,
      scale: [2, 3],
    });
  });

  it('rejects KHR_texture_transform requests for unsupported UV sets', async () => {
    const glb = rewriteGlbJson(
      makeGlb({ imageBytes: [1, 2, 3, 4], uvs: [0, 0, 1, 0, 0, 1] }),
      (root) => {
        root.materials![0]!.pbrMetallicRoughness!.baseColorTexture!.extensions = {
          KHR_texture_transform: { texCoord: 1 },
        };
      },
    );
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      message: expect.stringContaining('TEXCOORD_1'),
    });
  });

  it('rejects documents that require an unsupported extension', async () => {
    const glb = rewriteGlbJson(makeGlb(), (root) => {
      root.extensionsRequired = ['EXT_fixture_required'];
    });
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      message: expect.stringContaining('EXT_fixture_required'),
    });
  });

  it('retains optional extension declarations without rejecting otherwise valid core data', async () => {
    const glb = rewriteGlbJson(makeGlb(), (root) => {
      root.extensionsUsed = ['EXT_fixture_optional'];
    });
    const result = await new GlbImporter().import(glb, context);
    expect(result.data.extensionsUsed).toContain('EXT_fixture_optional');
  });

  it('rejects accessors whose declared element range exceeds the bufferView', async () => {
    const glb = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.count = 100;
    });
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });
  });

  it('rejects bufferViews that exceed the declared embedded buffer', async () => {
    const glb = rewriteGlbJson(makeGlb(), (root) => {
      root.bufferViews![0]!.byteOffset = root.buffers![0]!.byteLength;
    });
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });
  });

  it('decomposes matrix-authored nodes into equivalent TRS transforms', async () => {
    const matrix = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1];
    const result = await new GlbImporter().import(makeGlb({ nodeMatrix: matrix }), context);
    expect(result.data.nodes[0]?.translation).toEqual([5, 6, 7]);
    expect(result.data.nodes[0]?.rotation).toEqual([0, 0, 0, 1]);
    expect(result.data.nodes[0]?.scale).toEqual([2, 3, 4]);
    expect(result.data.nodes[0]?.matrix).toEqual(matrix);
  });

  it('rejects matrix-authored nodes containing shear instead of silently approximating them', async () => {
    const matrix = [1, 0, 0, 0, 0.25, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    await expect(
      new GlbImporter().import(makeGlb({ nodeMatrix: matrix }), context),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
  });

  it('retains embedded image bytes and resolves texture sampler/material references', async () => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10];
    const result = await new GlbImporter().import(
      makeGlb({ imageBytes: bytes, uvs: [0, 0, 1, 0, 0, 1] }),
      context,
    );
    expect(result.data.images).toHaveLength(1);
    expect(result.data.images[0]?.mimeType).toBe('image/png');
    expect(Array.from(result.data.images[0]!.data)).toEqual(bytes);
    expect(result.data.samplers[0]).toEqual({
      magFilter: 9729,
      minFilter: 9987,
      wrapS: 10497,
      wrapT: 33071,
    });
    expect(result.data.textures[0]).toMatchObject({
      source: 0,
      sampler: 0,
      mimeType: 'image/png',
      embedded: true,
    });
    expect(result.data.materials[0]?.baseColorTexture).toBe(0);
  });

  it('generates vertex normals when NORMAL is absent', async () => {
    const result = await new GlbImporter().import(makeGlb({ normals: false }), context);
    expect(Array.from(result.data.meshes[0]!.primitives[0]!.mesh.normals)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it('rejects malformed headers and unsupported primitive modes', async () => {
    await expect(new GlbImporter().import(new ArrayBuffer(8), context)).rejects.toMatchObject({
      code: 'INVALID_GLB',
    });
    await expect(new GlbImporter().import(makeGlb({ mode: 1 }), context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
    });
  });

  it('rejects out-of-range primitive indices', async () => {
    await expect(
      new GlbImporter().import(makeGlb({ indices: [0, 1, 9] }), context),
    ).rejects.toMatchObject({ code: 'INVALID_ACCESSOR' });
  });

  it('enforces triangle and embedded texture budgets before building imported assets', async () => {
    const twoTriangles = makeGlb({ indices: [0, 1, 2, 0, 2, 1] });
    await expect(
      new GlbImporter().import(twoTriangles, {
        ...context,
        settings: { maxTriangles: 1 },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });

    const textured = makeGlb({ imageBytes: [1, 2, 3, 4], uvs: [0, 0, 1, 0, 0, 1] });
    await expect(
      new GlbImporter().import(textured, {
        ...context,
        settings: { maxTextureBytes: 3 },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('rejects hostile declared accessor sizes before allocating geometry output', async () => {
    const oversized = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.count = 1_000_000;
    });
    await expect(
      new GlbImporter().import(oversized, {
        ...context,
        settings: { maxVertices: 100_000 },
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      message: expect.stringContaining('vertices'),
    });
  });

  it('keeps concurrent repeated imports isolated and does not mutate the source GLB', async () => {
    const source = makeGlb({ imageBytes: [1, 2, 3, 4], uvs: [0, 0, 1, 0, 0, 1] });
    const originalBytes = new Uint8Array(source).slice();
    const importer = new GlbImporter();
    const results = await Promise.all(
      Array.from({ length: 24 }, () => importer.import(source, context)),
    );
    const positionBuffers = results.map(
      (result) => result.data.meshes[0]!.primitives[0]!.mesh.positions,
    );
    expect(new Uint8Array(source)).toEqual(originalBytes);
    expect(new Set(positionBuffers).size).toBe(results.length);

    positionBuffers[0]![0] = 123;
    expect(positionBuffers.slice(1).every((positions) => positions[0] === 0)).toBe(true);
    expect(results.every((result) => result.data.images[0]?.data.length === 4)).toBe(true);
  });

  it('honors an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new GlbImporter().import(makeGlb(), { ...context, signal: controller.signal }),
    ).rejects.toBeInstanceOf(GlbImportError);
  });
});
