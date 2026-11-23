import { MeshoptEncoder } from 'meshoptimizer';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GlbImportError, GlbImporter } from './index.js';
import { sampleAnimationTrack } from '@engine/animation';

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
  accessors?: { count: number; byteOffset?: number; normalized?: boolean; sparse?: unknown }[];
  bufferViews?: { byteOffset?: number; byteLength?: number; byteStride?: number }[];
  buffers?: { byteLength: number }[];
  materials?: {
    alphaMode?: string;
    alphaCutoff?: number;
    doubleSided?: unknown;
    normalTexture?: { index?: number; scale?: number };
    occlusionTexture?: { index?: number; strength?: number };
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

function replaceGlbJson(source: ArrayBuffer, json: string): ArrayBuffer {
  const output = source.slice(0);
  const jsonLength = new DataView(output).getUint32(12, true);
  const chunk = new Uint8Array(output, 20, jsonLength);
  const encoded = new TextEncoder().encode(json);
  if (encoded.length > chunk.length) throw new Error('Replacement JSON exceeds GLB JSON chunk');
  chunk.fill(0x20);
  chunk.set(encoded);
  return output;
}

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

function makeSkinnedAnimatedGlb(
  interpolation: 'STEP' | 'LINEAR' | 'CUBICSPLINE' = 'LINEAR',
): ArrayBuffer {
  const cubic = interpolation === 'CUBICSPLINE';
  const translation = cubic
    ? [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]
    : [0, 0, 0, 1, 0, 0];
  const rotation = cubic
    ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
    : [0, 0, 0, 1, 0, 0, 1, 0];
  const scale = cubic ? [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0] : [1, 1, 1, 2, 2, 2];
  const animationValues = [0, 1, ...translation, ...rotation, ...scale];
  const matrixOffset = animationValues.length * 4;
  const positionOffset = matrixOffset + 128;
  const jointOffset = positionOffset + 36;
  const weightOffset = jointOffset + 12;
  const binary = new Uint8Array(weightOffset + 48);
  const binaryView = new DataView(binary.buffer);
  const floatValues = [
    ...animationValues,
    ...Array.from({ length: 32 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  ];
  floatValues.forEach((value, index) => binaryView.setFloat32(index * 4, value, true));
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) =>
    binaryView.setFloat32(positionOffset + index * 4, value, true),
  );
  binary.set([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], jointOffset);
  Array.from({ length: 12 }, (_, i) => (i % 4 === 0 ? 1 : 0)).forEach((value, index) =>
    binaryView.setFloat32(weightOffset + index * 4, value, true),
  );
  const translationOffset = 8;
  const rotationOffset = translationOffset + translation.length * 4;
  const scaleOffset = rotationOffset + rotation.length * 4;
  const root = {
    asset: { version: '2.0', generator: 'animation-fixture' },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: translationOffset, byteLength: translation.length * 4 },
      { buffer: 0, byteOffset: rotationOffset, byteLength: rotation.length * 4 },
      { buffer: 0, byteOffset: scaleOffset, byteLength: scale.length * 4 },
      { buffer: 0, byteOffset: matrixOffset, byteLength: 128 },
      { buffer: 0, byteOffset: positionOffset, byteLength: 36 },
      { buffer: 0, byteOffset: jointOffset, byteLength: 12 },
      { buffer: 0, byteOffset: weightOffset, byteLength: 48 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: translation.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: rotation.length / 4, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: scale.length / 3, type: 'VEC3' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 5, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 6, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 7, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    nodes: [
      { name: 'Root', children: [1, 2] },
      { name: 'Joint', translation: [0, 0, 0] },
      { name: 'SkinnedMesh', mesh: 0, skin: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 5, JOINTS_0: 6, WEIGHTS_0: 7 } }] }],
    skins: [{ name: 'TwoJointSkin', joints: [1, 0], inverseBindMatrices: 4, skeleton: 0 }],
    animations: [
      {
        name: 'Walk',
        samplers: [
          { input: 0, output: 1, interpolation },
          { input: 0, output: 2, interpolation },
          { input: 0, output: 3, interpolation },
        ],
        channels: [
          { sampler: 0, target: { node: 1, path: 'translation' } },
          { sampler: 1, target: { node: 1, path: 'rotation' } },
          { sampler: 2, target: { node: 1, path: 'scale' } },
        ],
      },
    ],
  };
  const json = new TextEncoder().encode(JSON.stringify(root));
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
  it('imports a representative external Fox GLB with skinning and multiple animation clips', async () => {
    const fixture = await readFile(new URL('./fixtures/Fox.glb', import.meta.url));
    const source = fixture.buffer.slice(
      fixture.byteOffset,
      fixture.byteOffset + fixture.byteLength,
    );
    const result = await new GlbImporter().import(source, {
      ...context,
      uri: 'fixtures/Fox.glb',
    });

    expect(result.data.skins).toHaveLength(1);
    expect(result.data.skins[0]?.joints).toHaveLength(24);
    expect(result.data.animations.map((clip) => clip.name)).toEqual(['Survey', 'Walk', 'Run']);
    expect(
      new Set(
        result.data.animations.flatMap((clip) =>
          clip.channels.map((channel) => channel.track.path),
        ),
      ),
    ).toEqual(new Set(['translation', 'rotation']));
    const skinnedPrimitive = result.data.meshes
      .flatMap((mesh) => mesh.primitives)
      .find((primitive) => primitive.skinning !== undefined);
    expect(skinnedPrimitive?.skinning?.joints).toHaveLength(6912);
    expect(skinnedPrimitive?.skinning?.weights).toHaveLength(6912);
  });

  it('imports skin joint order, inverse bind matrices and animation channels', async () => {
    const result = await new GlbImporter().import(makeSkinnedAnimatedGlb(), context);
    expect(result.data.nodes[1]?.skin).toBeNull();
    expect(result.data.skins[0]?.joints).toEqual(new Uint32Array([1, 0]));
    expect(result.data.skins[0]?.skeletonRoot).toBe(0);
    expect(result.data.skins[0]?.inverseBindMatrices).toHaveLength(32);
    expect(result.data.animations[0]).toMatchObject({ name: 'Walk', duration: 1 });
    expect(result.data.animations[0]?.channels.map((channel) => channel.track.path)).toEqual([
      'translation',
      'rotation',
      'scale',
    ]);
    expect(result.data.nodes[2]?.skin).toBe(0);
    expect(result.data.meshes[0]?.primitives[0]?.skinning?.joints).toEqual(
      new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]),
    );
    expect(result.data.meshes[0]?.primitives[0]?.skinning?.weights).toEqual(
      new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    );
    expect(result.data.animations[0]?.channels[0]?.nodeIndex).toBe(1);
    expect([...result.data.animations[0]!.channels[0]!.track.times]).toEqual([0, 1]);
    expect([...result.data.animations[0]!.channels[0]!.track.values]).toEqual([0, 0, 0, 1, 0, 0]);
    expect(result.metadata).toMatchObject({
      animationCount: 1,
      skinCount: 1,
      animationKeys: 6,
      animationChannels: 3,
      skinJointCount: 2,
    });
  });

  it.each(['STEP', 'LINEAR', 'CUBICSPLINE'] as const)(
    'decodes %s animation sampler interpolation',
    async (interpolation) => {
      const result = await new GlbImporter().import(makeSkinnedAnimatedGlb(interpolation), context);
      const track = result.data.animations[0]!.channels[0]!.track;
      expect(track.interpolation).toBe(interpolation);
      expect(sampleAnimationTrack(track, 0.5)[0]).toBeCloseTo(interpolation === 'STEP' ? 0 : 0.5);
    },
  );

  it('defaults omitted inverse bind matrices to identity and enforces animation budgets', async () => {
    const noMatrices = rewriteGlbJson(makeSkinnedAnimatedGlb(), (root) => {
      delete (root as unknown as { skins: { inverseBindMatrices?: number }[] }).skins[0]!
        .inverseBindMatrices;
    });
    const result = await new GlbImporter().import(noMatrices, context);
    expect(result.data.skins[0]?.inverseBindMatrices[0]).toBe(1);
    expect(result.data.skins[0]?.inverseBindMatrices[5]).toBe(1);
    await expect(
      new GlbImporter().import(makeSkinnedAnimatedGlb(), {
        ...context,
        settings: { maxAnimationKeys: 1 },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(
      new GlbImporter().import(makeSkinnedAnimatedGlb(), {
        ...context,
        settings: { maxSkinJoints: 1 },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(
      new GlbImporter().import(makeSkinnedAnimatedGlb(), {
        ...context,
        settings: { maxAnimationChannels: 2 },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('rejects invalid skin references and unsupported animation target paths', async () => {
    const invalidSkin = rewriteGlbJson(makeSkinnedAnimatedGlb(), (root) => {
      (root as unknown as { skins: { joints: number[] }[] }).skins[0]!.joints = [9, 0];
    });
    await expect(new GlbImporter().import(invalidSkin, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });
    const weights = rewriteGlbJson(makeSkinnedAnimatedGlb(), (root) => {
      (
        root as unknown as { animations: { channels: { target: { path: string } }[] }[] }
      ).animations[0]!.channels[0]!.target.path = 'weights';
    });
    await expect(new GlbImporter().import(weights, context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
    });
    const floatingJoints = rewriteGlbJson(makeSkinnedAnimatedGlb(), (root) => {
      (root as unknown as { accessors: { componentType: number }[] }).accessors[6]!.componentType =
        5126;
    });
    await expect(new GlbImporter().import(floatingJoints, context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
    });
    const signedWeights = rewriteGlbJson(makeSkinnedAnimatedGlb(), (root) => {
      const accessor = (
        root as unknown as { accessors: { componentType: number; normalized?: boolean }[] }
      ).accessors[7]!;
      accessor.componentType = 5122;
      accessor.normalized = true;
    });
    await expect(new GlbImporter().import(signedWeights, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });
  });

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

  it('imports glTF alpha and normal/occlusion material controls', async () => {
    const glb = rewriteGlbJson(
      makeGlb({
        imageBytes: [1, 2, 3, 4],
        uvs: [0, 0, 1, 0, 0, 1],
        allTextureChannels: true,
      }),
      (root) => {
        root.materials![0]!.alphaMode = 'MASK';
        root.materials![0]!.alphaCutoff = 0.37;
        root.materials![0]!.doubleSided = true;
        root.materials![0]!.normalTexture!.scale = 0.45;
        root.materials![0]!.occlusionTexture!.strength = 0.62;
      },
    );
    const result = await new GlbImporter().import(glb, context);
    expect(result.data.materials[0]).toMatchObject({
      alphaMode: 'MASK',
      alphaCutoff: 0.37,
      doubleSided: true,
      normalScale: 0.45,
      occlusionStrength: 0.62,
    });
  });

  it('rejects non-boolean glTF doubleSided values', async () => {
    const glb = rewriteGlbJson(makeGlb(), (root) => {
      root.materials![0]!.doubleSided = 'false';
    });
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      code: 'INVALID_GLB',
      message: expect.stringContaining('doubleSided must be a boolean'),
    });
  });

  it('rejects out-of-range glTF occlusion strength', async () => {
    const glb = rewriteGlbJson(
      makeGlb({
        imageBytes: [1, 2, 3, 4],
        uvs: [0, 0, 1, 0, 0, 1],
        allTextureChannels: true,
      }),
      (root) => {
        root.materials![0]!.occlusionTexture!.strength = 1.01;
      },
    );
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      code: 'INVALID_GLB',
      message: expect.stringContaining('invalid PBR factors'),
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

  it('rejects sparse accessors explicitly instead of partially decoding them', async () => {
    const sparse = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.sparse = {
        count: 1,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 0 },
      };
    });
    await expect(new GlbImporter().import(sparse, context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      message: expect.stringContaining('Sparse accessors are not supported'),
    });
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

  it('rejects non-object JSON roots and non-array metadata with stable GLB errors', async () => {
    const nullRoot = replaceGlbJson(makeGlb(), 'null');
    await expect(new GlbImporter().import(nullRoot, context)).rejects.toMatchObject({
      name: 'GlbImportError',
      code: 'INVALID_GLB',
      message: expect.stringContaining('JSON root must be an object'),
    });

    const invalidBuffers = rewriteGlbJson(makeGlb(), (root) => {
      Object.assign(root, { buffers: {} });
    });
    await expect(new GlbImporter().import(invalidBuffers, context)).rejects.toMatchObject({
      name: 'GlbImportError',
      code: 'INVALID_GLB',
      message: expect.stringContaining('buffers must be an array'),
    });
  });

  it('rejects negative embedded buffer lengths before import', async () => {
    const glb = rewriteGlbJson(makeGlb(), (root) => {
      root.buffers![0]!.byteLength = -1;
    });
    await expect(new GlbImporter().import(glb, context)).rejects.toMatchObject({
      name: 'GlbImportError',
      code: 'INVALID_GLB',
    });
  });

  it('rejects fractional and misaligned accessor byte offsets', async () => {
    const fractionalAccessorOffset = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.byteOffset = 0.5;
      root.bufferViews![0]!.byteLength = 40;
    });
    await expect(new GlbImporter().import(fractionalAccessorOffset, context)).rejects.toMatchObject(
      { code: 'INVALID_ACCESSOR' },
    );

    const misalignedAccessorOffset = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.byteOffset = 1;
      root.bufferViews![0]!.byteLength = 40;
    });
    await expect(new GlbImporter().import(misalignedAccessorOffset, context)).rejects.toMatchObject(
      { code: 'INVALID_ACCESSOR' },
    );

    const misalignedBufferViewOffset = rewriteGlbJson(makeGlb(), (root) => {
      root.bufferViews![0]!.byteOffset = 1;
      root.bufferViews![0]!.byteLength = 40;
    });
    await expect(
      new GlbImporter().import(misalignedBufferViewOffset, context),
    ).rejects.toMatchObject({ code: 'INVALID_ACCESSOR' });
  });

  it('rejects invalid accessor counts, strides and bufferView lengths', async () => {
    const fractionalCount = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.count = 1.5;
    });
    await expect(new GlbImporter().import(fractionalCount, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });

    const fractionalStride = rewriteGlbJson(makeGlb(), (root) => {
      root.bufferViews![0]!.byteStride = 12.5;
    });
    await expect(new GlbImporter().import(fractionalStride, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });

    const negativeViewLength = rewriteGlbJson(makeGlb(), (root) => {
      root.bufferViews![0]!.byteLength = -1;
    });
    await expect(new GlbImporter().import(negativeViewLength, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });
  });

  it('rejects normalized index and floating-point accessors', async () => {
    const normalizedIndices = rewriteGlbJson(makeGlb({ indices: [0, 1, 2] }), (root) => {
      root.accessors![2]!.normalized = true;
    });
    await expect(new GlbImporter().import(normalizedIndices, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });

    const normalizedFloats = rewriteGlbJson(makeGlb(), (root) => {
      root.accessors![0]!.normalized = true;
    });
    await expect(new GlbImporter().import(normalizedFloats, context)).rejects.toMatchObject({
      code: 'INVALID_ACCESSOR',
    });
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
