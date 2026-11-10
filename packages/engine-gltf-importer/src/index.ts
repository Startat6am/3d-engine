import type { AssetImportContext, AssetImporter, ImportedAsset } from '@engine/assets';
import { validateMeshData, type MeshData } from '@engine/geometry';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export interface GltfPbrMaterial {
  readonly name: string;
  readonly baseColorFactor: readonly [number, number, number, number];
  readonly metallicFactor: number;
  readonly roughnessFactor: number;
  readonly baseColorTexture?: number;
  readonly metallicRoughnessTexture?: number;
  readonly normalTexture?: number;
  readonly occlusionTexture?: number;
  readonly emissiveTexture?: number;
  readonly emissiveFactor: readonly [number, number, number];
  readonly alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  readonly alphaCutoff: number;
  readonly doubleSided: boolean;
}

export interface GltfPrimitive {
  readonly mesh: MeshData;
  readonly material: number | null;
  readonly mode: 4;
}

export interface GltfMesh {
  readonly name: string;
  readonly primitives: readonly GltfPrimitive[];
}

export interface GltfNode {
  readonly name: string;
  readonly mesh: number | null;
  readonly children: readonly number[];
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
  readonly matrix?: readonly number[];
}

export interface GltfTextureInfo {
  readonly source: number | null;
  readonly sampler: number | null;
  readonly mimeType: string | null;
  readonly embedded: boolean;
}

export interface GlbAsset {
  readonly version: 2;
  readonly generator: string;
  readonly meshes: readonly GltfMesh[];
  readonly materials: readonly GltfPbrMaterial[];
  readonly nodes: readonly GltfNode[];
  readonly textures: readonly GltfTextureInfo[];
  readonly extensionsUsed: readonly string[];
  readonly extensionsRequired: readonly string[];
}

export class GlbImportError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_GLB' | 'UNSUPPORTED_FEATURE' | 'INVALID_ACCESSOR' | 'ABORTED',
  ) {
    super(message);
    this.name = 'GlbImportError';
  }
}

interface GltfRoot {
  asset?: { version?: string; generator?: string };
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType?: number;
    count?: number;
    type?: string;
    normalized?: boolean;
    sparse?: unknown;
  }[];
  meshes?: { name?: string; primitives?: { attributes?: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      metallicFactor?: number;
      roughnessFactor?: number;
      baseColorTexture?: { index?: number };
      metallicRoughnessTexture?: { index?: number };
    };
    normalTexture?: { index?: number };
    occlusionTexture?: { index?: number };
    emissiveTexture?: { index?: number };
    emissiveFactor?: number[];
    alphaMode?: string;
    alphaCutoff?: number;
    doubleSided?: boolean;
  }[];
  nodes?: {
    name?: string;
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }[];
  textures?: { source?: number; sampler?: number }[];
  images?: { mimeType?: string; bufferView?: number; uri?: string }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new GlbImportError('GLB import was aborted', 'ABORTED');
}

function fail(message: string, code: GlbImportError['code'] = 'INVALID_GLB'): never {
  throw new GlbImportError(message, code);
}

function parseGlb(source: ArrayBuffer): { root: GltfRoot; binary: Uint8Array } {
  if (source.byteLength < 20) fail('GLB file is shorter than its minimum header and JSON chunk');
  const view = new DataView(source);
  if (view.getUint32(0, true) !== GLB_MAGIC) fail('Invalid GLB magic');
  if (view.getUint32(4, true) !== 2) fail('Only GLB version 2 is supported', 'UNSUPPORTED_FEATURE');
  if (view.getUint32(8, true) !== source.byteLength) fail('GLB declared length does not match input length');

  let offset = 12;
  let json: string | undefined;
  let binary = new Uint8Array();
  let sawBinary = false;
  while (offset < source.byteLength) {
    if (offset + 8 > source.byteLength) fail('Truncated GLB chunk header');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 !== 0 || offset + length > source.byteLength) fail('Invalid GLB chunk length or alignment');
    if (type === JSON_CHUNK) {
      if (json !== undefined || offset !== 20) fail('GLB must contain exactly one JSON chunk first');
      json = new TextDecoder().decode(new Uint8Array(source, offset, length)).replace(/[\u0000\u0020]+$/g, '');
    } else if (type === BIN_CHUNK) {
      if (sawBinary) fail('GLB contains more than one BIN chunk');
      binary = new Uint8Array(source, offset, length);
      sawBinary = true;
    }
    offset += length;
  }
  if (!json) fail('GLB JSON chunk is missing');
  let root: GltfRoot;
  try {
    root = JSON.parse(json) as GltfRoot;
  } catch {
    return fail('GLB JSON chunk is malformed');
  }
  if (root.asset?.version !== '2.0') fail('glTF asset.version must be 2.0', 'UNSUPPORTED_FEATURE');
  const buffers = root.buffers ?? [];
  if (root.extensionsRequired?.length) fail(`Required glTF extensions are not supported: ${root.extensionsRequired.join(', ')}`, 'UNSUPPORTED_FEATURE');
  if (buffers.length > 1) fail('Only one embedded GLB buffer is supported', 'UNSUPPORTED_FEATURE');
  if (buffers[0]?.uri) fail('External/data URI buffers are not supported in GLB import', 'UNSUPPORTED_FEATURE');
  if (buffers[0] && (!Number.isInteger(buffers[0].byteLength) || buffers[0].byteLength! > binary.byteLength)) {
    fail('GLB BIN chunk is shorter than buffer.byteLength');
  }
  if ((root.accessors?.length ?? 0) > 0 && !buffers[0]) fail('Accessors require an embedded GLB buffer');
  for (const [index, bufferView] of (root.bufferViews ?? []).entries()) {
    const start = bufferView.byteOffset ?? 0;
    const length = bufferView.byteLength;
    if (bufferView.buffer !== 0 || !Number.isInteger(start) || start < 0 ||
      !Number.isInteger(length) || length! < 0 || start + length! > (buffers[0]?.byteLength ?? 0)) {
      fail(`bufferView ${index} is outside the declared embedded buffer`, 'INVALID_ACCESSOR');
    }
    if (bufferView.byteStride !== undefined &&
      (!Number.isInteger(bufferView.byteStride) || bufferView.byteStride < 4 || bufferView.byteStride > 252 || bufferView.byteStride % 4 !== 0)) {
      fail(`bufferView ${index} has an invalid byteStride`, 'INVALID_ACCESSOR');
    }
  }
  return { root, binary };
}

function readAccessor(root: GltfRoot, binary: Uint8Array, index: number, expectedType: 'VEC3' | 'SCALAR'): number[] {
  const accessor = root.accessors?.[index];
  if (!accessor) fail(`Accessor ${index} does not exist`, 'INVALID_ACCESSOR');
  if (accessor.sparse) fail('Sparse accessors are not supported', 'UNSUPPORTED_FEATURE');
  if (accessor.type !== expectedType || !Number.isInteger(accessor.count) || accessor.count! < 1) {
    fail(`Accessor ${index} has an invalid type or count`, 'INVALID_ACCESSOR');
  }
  if (accessor.normalized) fail('Normalized vertex/index accessors are not supported', 'UNSUPPORTED_FEATURE');
  const componentType = accessor.componentType;
  const bytes = componentType === 5126 ? 4 : componentType === 5123 ? 2 : componentType === 5121 ? 1 : componentType === 5125 ? 4 : 0;
  if (!bytes || (expectedType === 'VEC3' && componentType !== 5126) || (expectedType === 'SCALAR' && ![5121, 5123, 5125].includes(componentType!))) {
    fail(`Accessor ${index} uses an unsupported component type`, 'UNSUPPORTED_FEATURE');
  }
  const viewIndex = accessor.bufferView;
  const bufferView = root.bufferViews?.[viewIndex ?? -1];
  if (!bufferView || bufferView.buffer !== 0) fail(`Accessor ${index} references an invalid bufferView`, 'INVALID_ACCESSOR');
  const components = expectedType === 'VEC3' ? 3 : 1;
  const elementBytes = components * bytes;
  const stride = bufferView.byteStride ?? elementBytes;
  const accessorOffset = accessor.byteOffset ?? 0;
  const viewOffset = bufferView.byteOffset ?? 0;
  const viewLength = bufferView.byteLength ?? 0;
  if (stride < elementBytes || stride % bytes !== 0 || accessorOffset < 0 || viewOffset < 0 || viewLength < 0) {
    fail(`Accessor ${index} has invalid byte layout`, 'INVALID_ACCESSOR');
  }
  const required = accessor.count! === 0 ? 0 : accessorOffset + (accessor.count! - 1) * stride + elementBytes;
  if (required > viewLength || viewOffset + required > binary.byteLength) {
    fail(`Accessor ${index} reads beyond its bufferView`, 'INVALID_ACCESSOR');
  }
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const result: number[] = [];
  for (let item = 0; item < accessor.count!; item++) {
    for (let component = 0; component < components; component++) {
      const at = viewOffset + accessorOffset + item * stride + component * bytes;
      const value = componentType === 5126 ? data.getFloat32(at, true)
        : componentType === 5123 ? data.getUint16(at, true)
        : componentType === 5121 ? data.getUint8(at)
        : data.getUint32(at, true);
      if (!Number.isFinite(value)) fail(`Accessor ${index} contains a non-finite value`, 'INVALID_ACCESSOR');
      result.push(value);
    }
  }
  return result;
}

function makeNormals(positions: readonly number[], indices: readonly number[]): Float32Array {
  const normals = new Float64Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!, aby = positions[b + 1]! - positions[a + 1]!, abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!, acy = positions[c + 1]! - positions[a + 1]!, acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) { normals[vertex] = normals[vertex]! + nx; normals[vertex + 1] = normals[vertex + 1]! + ny; normals[vertex + 2] = normals[vertex + 2]! + nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length > 1e-12) normals.set([normals[i]! / length, normals[i + 1]! / length, normals[i + 2]! / length], i);
    else normals.set([0, 1, 0], i);
  }
  return Float32Array.from(normals);
}

function tuple<T extends readonly number[]>(values: number[] | undefined, defaults: T, length: number, label: string): T {
  const result = values ?? defaults;
  if (result.length !== length || !result.every(Number.isFinite)) fail(`Invalid ${label}`);
  return result as T;
}

function importDocument(root: GltfRoot, binary: Uint8Array, signal: AbortSignal): GlbAsset {
  const textureCount = root.textures?.length ?? 0;
  const validateTextureRef = (textureIndex: number | undefined, materialIndex: number): void => {
    if (textureIndex !== undefined && (!Number.isInteger(textureIndex) || textureIndex < 0 || textureIndex >= textureCount)) {
      fail(`Material ${materialIndex} references a missing texture`);
    }
  };
  const materials: GltfPbrMaterial[] = (root.materials ?? []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const alphaMode = material.alphaMode ?? 'OPAQUE';
    if (!['OPAQUE', 'MASK', 'BLEND'].includes(alphaMode)) fail(`Material ${index} has an invalid alphaMode`);
    validateTextureRef(pbr.baseColorTexture?.index, index);
    validateTextureRef(pbr.metallicRoughnessTexture?.index, index);
    validateTextureRef(material.normalTexture?.index, index);
    validateTextureRef(material.occlusionTexture?.index, index);
    validateTextureRef(material.emissiveTexture?.index, index);
    const factor = tuple(pbr.baseColorFactor, [1, 1, 1, 1] as const, 4, 'baseColorFactor');
    const emissive = tuple(material.emissiveFactor, [0, 0, 0] as const, 3, 'emissiveFactor');
    const metallic = pbr.metallicFactor ?? 1, roughness = pbr.roughnessFactor ?? 1, cutoff = material.alphaCutoff ?? 0.5;
    if (![metallic, roughness, cutoff, ...factor, ...emissive].every(Number.isFinite) ||
      metallic < 0 || metallic > 1 || roughness < 0 || roughness > 1 || cutoff < 0) fail(`Material ${index} has invalid PBR factors`);
    return {
      name: material.name ?? `Material ${index}`,
      baseColorFactor: factor,
      metallicFactor: metallic,
      roughnessFactor: roughness,
      ...(pbr.baseColorTexture?.index !== undefined ? { baseColorTexture: pbr.baseColorTexture.index } : {}),
      ...(pbr.metallicRoughnessTexture?.index !== undefined ? { metallicRoughnessTexture: pbr.metallicRoughnessTexture.index } : {}),
      ...(material.normalTexture?.index !== undefined ? { normalTexture: material.normalTexture.index } : {}),
      ...(material.occlusionTexture?.index !== undefined ? { occlusionTexture: material.occlusionTexture.index } : {}),
      ...(material.emissiveTexture?.index !== undefined ? { emissiveTexture: material.emissiveTexture.index } : {}),
      emissiveFactor: emissive,
      alphaMode: alphaMode as GltfPbrMaterial['alphaMode'],
      alphaCutoff: cutoff,
      doubleSided: material.doubleSided ?? false,
    };
  });

  const meshes: GltfMesh[] = (root.meshes ?? []).map((sourceMesh, meshIndex) => {
    abortIfNeeded(signal);
    if (!sourceMesh.primitives?.length) fail(`Mesh ${meshIndex} has no primitives`);
    const primitives = sourceMesh.primitives.map((primitive, primitiveIndex): GltfPrimitive => {
      if ((primitive.mode ?? 4) !== 4) fail('Only triangle-list primitives are supported', 'UNSUPPORTED_FEATURE');
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) fail(`Mesh ${meshIndex} primitive ${primitiveIndex} has no POSITION`);
      const positions = readAccessor(root, binary, positionAccessor, 'VEC3');
      const vertexCount = positions.length / 3;
      if (vertexCount < 3) fail('A triangle primitive requires at least three vertices');
      const indices = primitive.indices === undefined ? Array.from({ length: vertexCount }, (_, i) => i)
        : readAccessor(root, binary, primitive.indices, 'SCALAR');
      if (indices.length % 3 !== 0 || indices.some((value) => !Number.isInteger(value) || value < 0 || value >= vertexCount)) {
        fail('Primitive indices must reference valid triangle vertices', 'INVALID_ACCESSOR');
      }
      const normals = primitive.attributes?.NORMAL === undefined
        ? makeNormals(positions, indices)
        : Float32Array.from(readAccessor(root, binary, primitive.attributes.NORMAL, 'VEC3'));
      if (normals.length !== positions.length) fail('NORMAL accessor count does not match POSITION', 'INVALID_ACCESSOR');
      const mesh: MeshData = { positions: Float32Array.from(positions), normals, indices: Uint32Array.from(indices) };
      try { validateMeshData(mesh); } catch (error) { fail(`Invalid primitive geometry: ${String(error)}`, 'INVALID_ACCESSOR'); }
      if (primitive.material !== undefined && (!Number.isInteger(primitive.material) || !materials[primitive.material])) {
        fail(`Primitive references missing material ${primitive.material}`);
      }
      return { mesh, material: primitive.material ?? null, mode: 4 };
    });
    return { name: sourceMesh.name ?? `Mesh ${meshIndex}`, primitives };
  });

  const nodes: GltfNode[] = (root.nodes ?? []).map((node, index) => {
    const translation = tuple(node.translation, [0, 0, 0] as const, 3, `node ${index} translation`);
    const rotation = tuple(node.rotation, [0, 0, 0, 1] as const, 4, `node ${index} rotation`);
    const scale = tuple(node.scale, [1, 1, 1] as const, 3, `node ${index} scale`);
    if (node.mesh !== undefined && !meshes[node.mesh]) fail(`Node ${index} references missing mesh ${node.mesh}`);
    const children = node.children ?? [];
    if (children.some((child) => !Number.isInteger(child) || child < 0 || child >= (root.nodes?.length ?? 0))) fail(`Node ${index} references an invalid child`);
    if (node.matrix && (node.matrix.length !== 16 || !node.matrix.every(Number.isFinite))) fail(`Node ${index} has an invalid matrix`);
    return {
      name: node.name ?? `Node ${index}`,
      mesh: node.mesh ?? null,
      children,
      translation, rotation, scale,
      ...(node.matrix ? { matrix: node.matrix } : {}),
    };
  });

  const textures: GltfTextureInfo[] = (root.textures ?? []).map((texture, index) => {
    const image = root.images?.[texture.source ?? -1];
    if (texture.source !== undefined && !image) fail(`Texture ${index} references a missing image`);
    if (image?.uri) fail('External/data URI images are not supported; only embedded GLB image metadata is retained', 'UNSUPPORTED_FEATURE');
    if (image?.bufferView !== undefined && !root.bufferViews?.[image.bufferView]) fail(`Texture ${index} references an invalid image bufferView`);
    return {
      source: texture.source ?? null,
      sampler: texture.sampler ?? null,
      mimeType: image?.mimeType ?? null,
      embedded: image?.bufferView !== undefined,
    };
  });

  return {
    version: 2,
    generator: root.asset?.generator ?? 'unknown',
    meshes, materials, nodes, textures,
    extensionsUsed: root.extensionsUsed ?? [],
    extensionsRequired: root.extensionsRequired ?? [],
  };
}

/** Imports static GLB 2.0 triangle meshes and PBR material metadata without exposing renderer types. */
export class GlbImporter implements AssetImporter<GlbAsset> {
  readonly id = 'engine.gltf.glb';
  readonly version = '0.1.0';
  readonly extensions = ['glb'] as const;

  async import(source: ArrayBuffer, context: AssetImportContext): Promise<ImportedAsset<GlbAsset>> {
    abortIfNeeded(context.signal);
    const { root, binary } = parseGlb(source);
    abortIfNeeded(context.signal);
    const data = importDocument(root, binary, context.signal);
    abortIfNeeded(context.signal);
    return {
      kind: 'model',
      data,
      dependencies: [],
      metadata: {
        format: 'glb',
        version: '2.0',
        meshCount: data.meshes.length,
        primitiveCount: data.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
        materialCount: data.materials.length,
        textureCount: data.textures.length,
      },
    };
  }
}
