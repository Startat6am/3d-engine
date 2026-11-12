import { MeshoptDecoder } from 'meshoptimizer/decoder';
import type { AssetImportContext, AssetImporter, ImportedAsset } from '@engine/assets';
import { validateMeshData, type MeshData } from '@engine/geometry';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export interface GltfTextureTransform {
  readonly offset: readonly [number, number];
  readonly rotation: number;
  readonly scale: readonly [number, number];
}

export interface GltfPbrMaterial {
  readonly name: string;
  readonly baseColorFactor: readonly [number, number, number, number];
  readonly metallicFactor: number;
  readonly roughnessFactor: number;
  readonly baseColorTexture?: number;
  readonly metallicRoughnessTexture?: number;
  readonly normalTexture?: number;
  readonly normalScale: number;
  readonly occlusionTexture?: number;
  readonly occlusionStrength: number;
  readonly emissiveTexture?: number;
  readonly textureTransforms?: Partial<
    Record<
      'baseColor' | 'metallicRoughness' | 'normal' | 'occlusion' | 'emissive',
      GltfTextureTransform
    >
  >;
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

export interface GltfImageAsset {
  readonly name: string;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Encoded image bytes copied from the GLB BIN chunk; decoding is a renderer concern. */
  readonly data: Uint8Array;
}

export interface GltfSampler {
  readonly magFilter: number | null;
  readonly minFilter: number | null;
  readonly wrapS: number;
  readonly wrapT: number;
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
  readonly images: readonly GltfImageAsset[];
  readonly samplers: readonly GltfSampler[];
  readonly textures: readonly GltfTextureInfo[];
  readonly extensionsUsed: readonly string[];
  readonly extensionsRequired: readonly string[];
}

export class GlbImportError extends Error {
  constructor(
    message: string,
    readonly code:
      'INVALID_GLB' | 'UNSUPPORTED_FEATURE' | 'INVALID_ACCESSOR' | 'RESOURCE_LIMIT' | 'ABORTED',
  ) {
    super(message);
    this.name = 'GlbImportError';
  }
}

interface GltfTextureInfoInput {
  index?: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
  extensions?: {
    KHR_texture_transform?: {
      offset?: number[];
      rotation?: number;
      scale?: number[];
      texCoord?: number;
    };
  };
}

interface GltfRoot {
  asset?: { version?: string; generator?: string };
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: {
    buffer?: number;
    byteOffset?: number;
    byteLength?: number;
    byteStride?: number;
    extensions?: {
      EXT_meshopt_compression?: {
        buffer?: number;
        byteOffset?: number;
        byteLength?: number;
        byteStride?: number;
        count?: number;
        mode?: string;
        filter?: string;
      };
    };
  }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType?: number;
    count?: number;
    type?: string;
    normalized?: boolean;
    sparse?: unknown;
  }[];
  meshes?: {
    name?: string;
    primitives?: {
      attributes?: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }[];
  }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      metallicFactor?: number;
      roughnessFactor?: number;
      baseColorTexture?: GltfTextureInfoInput;
      metallicRoughnessTexture?: GltfTextureInfoInput;
    };
    normalTexture?: GltfTextureInfoInput;
    occlusionTexture?: GltfTextureInfoInput;
    emissiveTexture?: GltfTextureInfoInput;
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
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  images?: { name?: string; mimeType?: string; bufferView?: number; uri?: string }[];
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
  if (view.getUint32(8, true) !== source.byteLength)
    fail('GLB declared length does not match input length');

  let offset = 12;
  let json: string | undefined;
  let binary = new Uint8Array();
  let sawBinary = false;
  while (offset < source.byteLength) {
    if (offset + 8 > source.byteLength) fail('Truncated GLB chunk header');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 !== 0 || offset + length > source.byteLength)
      fail('Invalid GLB chunk length or alignment');
    if (type === JSON_CHUNK) {
      if (json !== undefined || offset !== 20)
        fail('GLB must contain exactly one JSON chunk first');
      const decoded = new TextDecoder().decode(new Uint8Array(source, offset, length));
      let end = decoded.length;
      while (end > 0 && (decoded.charCodeAt(end - 1) === 0 || decoded.charCodeAt(end - 1) === 0x20))
        end--;
      json = decoded.slice(0, end);
    } else if (type === BIN_CHUNK) {
      if (sawBinary) fail('GLB contains more than one BIN chunk');
      binary = new Uint8Array(source, offset, length);
      sawBinary = true;
    }
    offset += length;
  }
  if (!json) fail('GLB JSON chunk is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return fail('GLB JSON chunk is malformed');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    fail('GLB JSON root must be an object');
  const root = parsed as GltfRoot;
  const arrayFields: readonly (keyof GltfRoot)[] = [
    'buffers',
    'bufferViews',
    'accessors',
    'meshes',
    'materials',
    'nodes',
    'textures',
    'samplers',
    'images',
    'extensionsUsed',
    'extensionsRequired',
  ];
  for (const field of arrayFields) {
    if (root[field] !== undefined && !Array.isArray(root[field]))
      fail(`GLB ${field} must be an array`);
  }
  const objectArrayFields = [
    'buffers',
    'bufferViews',
    'accessors',
    'meshes',
    'materials',
    'nodes',
    'textures',
    'samplers',
    'images',
  ] as const;
  for (const field of objectArrayFields) {
    const entries = root[field] as unknown[] | undefined;
    const invalidIndex = entries?.findIndex(
      (entry) => !entry || typeof entry !== 'object' || Array.isArray(entry),
    );
    if (invalidIndex !== undefined && invalidIndex >= 0)
      fail(`GLB ${field}[${invalidIndex}] must be an object`);
  }
  if (root.extensionsUsed?.some((extension) => typeof extension !== 'string'))
    fail('GLB extensionsUsed entries must be strings');
  if (root.extensionsRequired?.some((extension) => typeof extension !== 'string'))
    fail('GLB extensionsRequired entries must be strings');
  if (root.asset?.version !== '2.0') fail('glTF asset.version must be 2.0', 'UNSUPPORTED_FEATURE');
  return { root, binary };
}

async function prepareGlbBuffers(
  root: GltfRoot,
  sourceBinary: Uint8Array,
  maxDecodedBytes: number,
): Promise<Uint8Array> {
  const supportedRequired = new Set([
    'EXT_meshopt_compression',
    'KHR_mesh_quantization',
    'KHR_texture_transform',
  ]);
  const unsupported = (root.extensionsRequired ?? []).filter(
    (extension) => !supportedRequired.has(extension),
  );
  if (unsupported.length)
    fail(
      `Required glTF extensions are not supported: ${unsupported.join(', ')}`,
      'UNSUPPORTED_FEATURE',
    );
  const buffers = root.buffers ?? [];
  if (buffers.some((buffer) => buffer.uri))
    fail('External/data URI buffers are not supported in GLB import', 'UNSUPPORTED_FEATURE');
  if (
    buffers[0] &&
    (!Number.isSafeInteger(buffers[0].byteLength) ||
      buffers[0].byteLength! < 0 ||
      buffers[0].byteLength! > sourceBinary.byteLength)
  )
    fail('GLB BIN chunk is shorter than buffer.byteLength');
  const views = root.bufferViews ?? [];
  if (views.some((view) => view.buffer !== 0 && !view.extensions?.EXT_meshopt_compression))
    fail('GLB bufferView references an unavailable buffer', 'UNSUPPORTED_FEATURE');

  // First reserve the final output ranges from metadata alone. Keeping every
  // decompressed meshopt buffer in an array while also allocating the combined
  // BIN buffer would temporarily retain two full copies of the decoded model.
  const compressedViews: {
    readonly index: number;
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly byteStride: number;
    readonly count: number;
    readonly mode: string;
    readonly filter?: string;
  }[] = [];
  let totalLength = sourceBinary.byteLength;
  for (const [index, view] of views.entries()) {
    const compression = view.extensions?.EXT_meshopt_compression;
    if (!compression) continue;
    const { buffer = 0, byteOffset = 0, byteLength, byteStride, count, mode, filter } = compression;
    if (
      buffer !== 0 ||
      !Number.isInteger(byteOffset) ||
      byteOffset < 0 ||
      !Number.isInteger(byteLength) ||
      byteLength! <= 0 ||
      !Number.isSafeInteger(byteOffset + byteLength!) ||
      byteOffset + byteLength! > sourceBinary.byteLength ||
      !Number.isInteger(byteStride) ||
      byteStride! <= 0 ||
      !Number.isInteger(count) ||
      count! < 0 ||
      !['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(mode ?? '')
    )
      fail(`bufferView ${index} has invalid EXT_meshopt_compression metadata`, 'INVALID_ACCESSOR');
    if (filter && !['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL', 'COLOR'].includes(filter))
      fail(`bufferView ${index} uses unsupported meshopt filter ${filter}`, 'UNSUPPORTED_FEATURE');
    const decodedByteLength = count! * byteStride!;
    if (!Number.isSafeInteger(decodedByteLength) || decodedByteLength <= 0)
      fail(`bufferView ${index} decoded size is invalid`, 'INVALID_ACCESSOR');
    totalLength = Math.ceil(totalLength / 4) * 4;
    const outputOffset = totalLength;
    view.buffer = 0;
    view.byteOffset = outputOffset;
    view.byteLength = decodedByteLength;
    if (mode === 'ATTRIBUTES') view.byteStride = byteStride!;
    else delete view.byteStride;
    delete view.extensions;
    compressedViews.push({
      index,
      byteOffset,
      byteLength: byteLength!,
      byteStride: byteStride!,
      count: count!,
      mode: mode!,
      ...(filter ? { filter } : {}),
    });
    totalLength += decodedByteLength;
    if (!Number.isSafeInteger(totalLength) || totalLength > maxDecodedBytes)
      fail(
        `Decoded GLB buffer bytes (${totalLength}) exceed the configured import limit (${maxDecodedBytes})`,
        'RESOURCE_LIMIT',
      );
  }
  if (!buffers[0] && (root.accessors?.length ?? 0) > 0)
    fail('Accessors require an embedded GLB buffer');
  root.buffers = [{ byteLength: totalLength }];
  if (compressedViews.length === 0) return sourceBinary;

  const binary = new Uint8Array(totalLength);
  binary.set(sourceBinary);
  // Decompress one view at a time directly into its reserved final range.
  for (const entry of compressedViews) {
    let decoded: Uint8Array;
    try {
      await MeshoptDecoder.ready;
      decoded = await MeshoptDecoder.decodeGltfBufferAsync(
        entry.count,
        entry.byteStride,
        sourceBinary.subarray(entry.byteOffset, entry.byteOffset + entry.byteLength),
        entry.mode,
        entry.filter,
      );
    } catch (error) {
      fail(
        `bufferView ${entry.index} meshopt decompression failed: ${error instanceof Error ? error.message : String(error)}`,
        'INVALID_ACCESSOR',
      );
    }
    if (decoded.byteLength !== entry.count * entry.byteStride)
      fail(`bufferView ${entry.index} decoded size is invalid`, 'INVALID_ACCESSOR');
    binary.set(decoded, views[entry.index]!.byteOffset);
  }
  return binary;
}
function validateGlbBufferViews(root: GltfRoot, binary: Uint8Array): void {
  for (const [index, view] of (root.bufferViews ?? []).entries()) {
    const start = view.byteOffset ?? 0;
    const length = view.byteLength;
    if (
      view.buffer !== 0 ||
      !Number.isInteger(start) ||
      start < 0 ||
      !Number.isInteger(length) ||
      length! < 0 ||
      start + length! > (root.buffers?.[0]?.byteLength ?? 0) ||
      start + length! > binary.byteLength
    )
      fail(`bufferView ${index} is outside the embedded buffer`, 'INVALID_ACCESSOR');
    if (
      view.byteStride !== undefined &&
      (!Number.isInteger(view.byteStride) ||
        view.byteStride < 4 ||
        view.byteStride > 252 ||
        view.byteStride % 4 !== 0)
    )
      fail(`bufferView ${index} has an invalid byteStride`, 'INVALID_ACCESSOR');
  }
}

function readAccessor(
  root: GltfRoot,
  binary: Uint8Array,
  index: number,
  expectedType: 'VEC2' | 'VEC3' | 'SCALAR',
): Float32Array | Uint32Array {
  const accessor = root.accessors?.[index];
  if (!accessor) fail(`Accessor ${index} does not exist`, 'INVALID_ACCESSOR');
  if (accessor.sparse) fail('Sparse accessors are not supported', 'UNSUPPORTED_FEATURE');
  if (
    accessor.type !== expectedType ||
    !Number.isSafeInteger(accessor.count) ||
    accessor.count! < 1
  ) {
    fail(`Accessor ${index} has an invalid type or count`, 'INVALID_ACCESSOR');
  }
  const componentType = accessor.componentType;
  const bytes = [5120, 5121].includes(componentType!)
    ? 1
    : [5122, 5123].includes(componentType!)
      ? 2
      : [5125, 5126].includes(componentType!)
        ? 4
        : 0;
  if (
    !bytes ||
    (expectedType === 'SCALAR' && ![5121, 5123, 5125].includes(componentType!)) ||
    (expectedType !== 'SCALAR' &&
      componentType !== 5126 &&
      !([5120, 5121, 5122, 5123].includes(componentType!) && accessor.normalized))
  ) {
    fail(`Accessor ${index} uses an unsupported component type`, 'UNSUPPORTED_FEATURE');
  }
  if (accessor.normalized !== undefined && typeof accessor.normalized !== 'boolean')
    fail(`Accessor ${index} normalized flag must be boolean`, 'INVALID_ACCESSOR');
  if (accessor.normalized && (expectedType === 'SCALAR' || componentType === 5126))
    fail(
      `Accessor ${index} uses normalized values for an invalid component type`,
      'INVALID_ACCESSOR',
    );
  const viewIndex = accessor.bufferView;
  const bufferView = root.bufferViews?.[viewIndex ?? -1];
  if (!bufferView || bufferView.buffer !== 0)
    fail(`Accessor ${index} references an invalid bufferView`, 'INVALID_ACCESSOR');
  const components = expectedType === 'VEC3' ? 3 : expectedType === 'VEC2' ? 2 : 1;
  const elementBytes = components * bytes;
  const stride = bufferView.byteStride ?? elementBytes;
  const accessorOffset = accessor.byteOffset ?? 0;
  const viewOffset = bufferView.byteOffset ?? 0;
  const viewLength = bufferView.byteLength ?? 0;
  if (
    !Number.isSafeInteger(stride) ||
    stride < elementBytes ||
    stride % bytes !== 0 ||
    !Number.isSafeInteger(accessorOffset) ||
    accessorOffset < 0 ||
    accessorOffset % bytes !== 0 ||
    !Number.isSafeInteger(viewOffset) ||
    viewOffset < 0 ||
    viewOffset % bytes !== 0 ||
    !Number.isSafeInteger(viewLength) ||
    viewLength < 0
  ) {
    fail(`Accessor ${index} has invalid or misaligned byte layout`, 'INVALID_ACCESSOR');
  }
  const required = accessorOffset + (accessor.count! - 1) * stride + elementBytes;
  if (
    !Number.isSafeInteger(required) ||
    !Number.isSafeInteger(viewOffset + required) ||
    required > viewLength ||
    viewOffset + required > binary.byteLength
  ) {
    fail(`Accessor ${index} reads beyond its bufferView`, 'INVALID_ACCESSOR');
  }
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  // Avoid boxed number[] allocations (8+ bytes per JS element plus array overhead).
  // Geometry accessors are materialized directly into their final renderer-ready buffers.
  const result =
    expectedType === 'SCALAR'
      ? new Uint32Array(accessor.count!)
      : new Float32Array(accessor.count! * components);
  for (let item = 0; item < accessor.count!; item++) {
    for (let component = 0; component < components; component++) {
      const at = viewOffset + accessorOffset + item * stride + component * bytes;
      const raw =
        componentType === 5126
          ? data.getFloat32(at, true)
          : componentType === 5125
            ? data.getUint32(at, true)
            : componentType === 5123
              ? data.getUint16(at, true)
              : componentType === 5122
                ? data.getInt16(at, true)
                : componentType === 5121
                  ? data.getUint8(at)
                  : data.getInt8(at);
      const value = accessor.normalized
        ? componentType === 5120
          ? Math.max(raw / 127, -1)
          : componentType === 5121
            ? raw / 255
            : componentType === 5122
              ? Math.max(raw / 32767, -1)
              : raw / 65535
        : raw;
      if (!Number.isFinite(value))
        fail(`Accessor ${index} contains a non-finite value`, 'INVALID_ACCESSOR');
      result[item * components + component] = value;
    }
  }
  return result;
}

function makeNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  // Float32 is sufficient for the final vertex normals and avoids a second,
  // double-sized accumulation buffer during large imports.
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3,
      b = indices[i + 1]! * 3,
      c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!,
      aby = positions[b + 1]! - positions[a + 1]!,
      abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!,
      acy = positions[c + 1]! - positions[a + 1]!,
      acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy,
      ny = abz * acx - abx * acz,
      nz = abx * acy - aby * acx;
    normals[a] = normals[a]! + nx;
    normals[a + 1] = normals[a + 1]! + ny;
    normals[a + 2] = normals[a + 2]! + nz;
    normals[b] = normals[b]! + nx;
    normals[b + 1] = normals[b + 1]! + ny;
    normals[b + 2] = normals[b + 2]! + nz;
    normals[c] = normals[c]! + nx;
    normals[c + 1] = normals[c + 1]! + ny;
    normals[c + 2] = normals[c + 2]! + nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length > 1e-12) {
      normals[i] = normals[i]! / length;
      normals[i + 1] = normals[i + 1]! / length;
      normals[i + 2] = normals[i + 2]! / length;
    } else {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
  }
  return normals;
}

function decomposeNodeMatrix(
  matrix: readonly number[],
  index: number,
): {
  translation: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  scale: readonly [number, number, number];
} {
  const epsilon = 1e-5;
  if (
    matrix.length !== 16 ||
    !matrix.every(Number.isFinite) ||
    Math.abs(matrix[3]!) > epsilon ||
    Math.abs(matrix[7]!) > epsilon ||
    Math.abs(matrix[11]!) > epsilon ||
    Math.abs(matrix[15]! - 1) > epsilon
  ) {
    fail(`Node ${index} matrix must be a finite affine transform`, 'UNSUPPORTED_FEATURE');
  }
  const x = [matrix[0]!, matrix[1]!, matrix[2]!];
  const y = [matrix[4]!, matrix[5]!, matrix[6]!];
  const z = [matrix[8]!, matrix[9]!, matrix[10]!];
  let sx = Math.hypot(...x);
  const sy = Math.hypot(...y);
  const sz = Math.hypot(...z);
  if (sx < epsilon || sy < epsilon || sz < epsilon) {
    fail(`Node ${index} matrix contains a zero scale`, 'UNSUPPORTED_FEATURE');
  }
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const nx = x.map((value) => value / sx);
  const ny = y.map((value) => value / sy);
  const nz = z.map((value) => value / sz);
  if (
    Math.abs(dot(nx, ny)) > epsilon ||
    Math.abs(dot(nx, nz)) > epsilon ||
    Math.abs(dot(ny, nz)) > epsilon
  ) {
    fail(
      `Node ${index} matrix contains shear and cannot be represented by Editor TRS`,
      'UNSUPPORTED_FEATURE',
    );
  }
  const cross = [
    ny[1]! * nz[2]! - ny[2]! * nz[1]!,
    ny[2]! * nz[0]! - ny[0]! * nz[2]!,
    ny[0]! * nz[1]! - ny[1]! * nz[0]!,
  ];
  if (dot(nx, cross) < 0) {
    sx = -sx;
    for (let i = 0; i < 3; i++) nx[i] = -nx[i]!;
  }
  // Rotation matrix entries are read by row from the column-major glTF matrix.
  const r00 = nx[0]!,
    r01 = ny[0]!,
    r02 = nz[0]!;
  const r10 = nx[1]!,
    r11 = ny[1]!,
    r12 = nz[1]!;
  const r20 = nx[2]!,
    r21 = ny[2]!,
    r22 = nz[2]!;
  const trace = r00 + r11 + r22;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const t = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * t;
    qx = (r21 - r12) / t;
    qy = (r02 - r20) / t;
    qz = (r10 - r01) / t;
  } else if (r00 > r11 && r00 > r22) {
    const t = Math.sqrt(1 + r00 - r11 - r22) * 2;
    qw = (r21 - r12) / t;
    qx = 0.25 * t;
    qy = (r01 + r10) / t;
    qz = (r02 + r20) / t;
  } else if (r11 > r22) {
    const t = Math.sqrt(1 + r11 - r00 - r22) * 2;
    qw = (r02 - r20) / t;
    qx = (r01 + r10) / t;
    qy = 0.25 * t;
    qz = (r12 + r21) / t;
  } else {
    const t = Math.sqrt(1 + r22 - r00 - r11) * 2;
    qw = (r10 - r01) / t;
    qx = (r02 + r20) / t;
    qy = (r12 + r21) / t;
    qz = 0.25 * t;
  }
  const qLength = Math.hypot(qx, qy, qz, qw);
  return {
    translation: [matrix[12]!, matrix[13]!, matrix[14]!],
    rotation: [qx / qLength, qy / qLength, qz / qLength, qw / qLength],
    scale: [sx, sy, sz],
  };
}

function tuple<T extends readonly number[]>(
  values: number[] | undefined,
  defaults: T,
  length: number,
  label: string,
): T {
  const result = values ?? defaults;
  if (result.length !== length || !result.every(Number.isFinite)) fail(`Invalid ${label}`);
  return result as T;
}

interface GlbImportBudget {
  readonly sourceBytes: number;
  readonly geometryBytes: number;
  readonly textureBytes: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

function budgetLimit(
  settings: AssetImportContext['settings'],
  key: string,
  fallback: number,
): number {
  const configured = settings[key];
  if (configured === undefined) return fallback;
  if (typeof configured !== 'number' || !Number.isSafeInteger(configured) || configured <= 0)
    fail(`Import setting ${key} must be a positive safe integer`);
  return configured;
}

function validateImportBudget(
  root: GltfRoot,
  sourceBytes: number,
  settings: AssetImportContext['settings'],
): GlbImportBudget {
  const accessors = root.accessors ?? [];
  const componentCounts: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  let geometryBytes = 0;
  const accessorBytes = (index: number): number => {
    const accessor = accessors[index];
    if (!accessor || !Number.isSafeInteger(accessor.count) || accessor.count! < 0)
      fail(`Accessor ${index} count is invalid`, 'INVALID_ACCESSOR');
    const components = componentCounts[accessor.type ?? ''];
    if (!components) fail(`Accessor ${index} has an unsupported type`, 'INVALID_ACCESSOR');
    const bytes = accessor.count! * components * 4;
    if (!Number.isSafeInteger(bytes))
      fail(`Accessor ${index} output size exceeds safe limits`, 'RESOURCE_LIMIT');
    return bytes;
  };
  let vertexCount = 0;
  let triangleCount = 0;
  for (const mesh of root.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const attributes = primitive.attributes ?? {};
      const position = attributes.POSITION;
      if (position === undefined) continue;
      const positionAccessor = accessors[position];
      if (!positionAccessor)
        fail(`POSITION accessor ${position} does not exist`, 'INVALID_ACCESSOR');
      const vertices = positionAccessor.count ?? 0;
      vertexCount += vertices;
      const usedAccessors = new Set(Object.values(attributes));
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const accessorIndex of usedAccessors) geometryBytes += accessorBytes(accessorIndex);
      // The importer materializes normals and sequential indices when absent.
      if (attributes.NORMAL === undefined) geometryBytes += vertices * 3 * 4;
      if (primitive.indices === undefined) geometryBytes += vertices * 4;
      const indexAccessor =
        primitive.indices === undefined ? undefined : accessors[primitive.indices];
      const elements = indexAccessor?.count ?? vertices;
      triangleCount += Math.floor(elements / 3);
      if (
        !Number.isSafeInteger(geometryBytes) ||
        !Number.isSafeInteger(vertexCount) ||
        !Number.isSafeInteger(triangleCount)
      )
        fail('GLB geometry totals exceed safe limits', 'RESOURCE_LIMIT');
    }
  }
  let textureBytes = 0;
  for (const image of root.images ?? []) {
    const view = image.bufferView === undefined ? undefined : root.bufferViews?.[image.bufferView];
    if (view) textureBytes += view.byteLength ?? 0;
  }
  const limits = [
    ['source bytes', sourceBytes, budgetLimit(settings, 'maxSourceBytes', 256 * 1024 * 1024)],
    [
      'decoded geometry bytes',
      geometryBytes,
      budgetLimit(settings, 'maxGeometryBytes', 384 * 1024 * 1024),
    ],
    [
      'embedded texture bytes',
      textureBytes,
      budgetLimit(settings, 'maxTextureBytes', 128 * 1024 * 1024),
    ],
    ['vertices', vertexCount, budgetLimit(settings, 'maxVertices', 8_000_000)],
    ['triangles', triangleCount, budgetLimit(settings, 'maxTriangles', 16_000_000)],
  ] as const;
  for (const [label, actual, maximum] of limits) {
    if (!Number.isSafeInteger(actual) || actual > maximum)
      fail(
        `GLB ${label} (${actual}) exceeds the configured import limit (${maximum})`,
        'RESOURCE_LIMIT',
      );
  }
  return { sourceBytes, geometryBytes, textureBytes, vertexCount, triangleCount };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function importDocument(root: GltfRoot, binary: Uint8Array, signal: AbortSignal): GlbAsset {
  const textureCount = root.textures?.length ?? 0;
  const validateTextureRef = (textureIndex: number | undefined, materialIndex: number): void => {
    if (
      textureIndex !== undefined &&
      (!Number.isInteger(textureIndex) || textureIndex < 0 || textureIndex >= textureCount)
    ) {
      fail(`Material ${materialIndex} references a missing texture`);
    }
  };
  const materials: GltfPbrMaterial[] = (root.materials ?? []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const textureInfos = {
      baseColor: pbr.baseColorTexture,
      metallicRoughness: pbr.metallicRoughnessTexture,
      normal: material.normalTexture,
      occlusion: material.occlusionTexture,
      emissive: material.emissiveTexture,
    };
    const textureTransforms: NonNullable<GltfPbrMaterial['textureTransforms']> = {};
    for (const [channel, textureInfo] of Object.entries(textureInfos)) {
      const extension = textureInfo?.extensions?.KHR_texture_transform;
      const texCoord = extension?.texCoord ?? textureInfo?.texCoord ?? 0;
      if (texCoord !== 0) {
        fail(
          `Material ${index} ${channel} texture requires unsupported TEXCOORD_${texCoord}`,
          'UNSUPPORTED_FEATURE',
        );
      }
      if (extension) {
        const offset = tuple(extension.offset, [0, 0] as const, 2, `${channel} texture offset`);
        const scale = tuple(extension.scale, [1, 1] as const, 2, `${channel} texture scale`);
        const rotation = extension.rotation ?? 0;
        if (!Number.isFinite(rotation))
          fail(`Material ${index} ${channel} texture rotation is invalid`);
        textureTransforms[channel as keyof typeof textureTransforms] = { offset, rotation, scale };
      }
    }
    const alphaMode = material.alphaMode ?? 'OPAQUE';
    if (!['OPAQUE', 'MASK', 'BLEND'].includes(alphaMode))
      fail(`Material ${index} has an invalid alphaMode`);
    validateTextureRef(pbr.baseColorTexture?.index, index);
    validateTextureRef(pbr.metallicRoughnessTexture?.index, index);
    validateTextureRef(material.normalTexture?.index, index);
    validateTextureRef(material.occlusionTexture?.index, index);
    validateTextureRef(material.emissiveTexture?.index, index);
    const factor = tuple(pbr.baseColorFactor, [1, 1, 1, 1] as const, 4, 'baseColorFactor');
    const emissive = tuple(material.emissiveFactor, [0, 0, 0] as const, 3, 'emissiveFactor');
    const metallic = pbr.metallicFactor ?? 1,
      roughness = pbr.roughnessFactor ?? 1,
      cutoff = material.alphaCutoff ?? 0.5,
      normalScale = material.normalTexture?.scale ?? 1,
      occlusionStrength = material.occlusionTexture?.strength ?? 1;
    if (
      ![metallic, roughness, cutoff, normalScale, occlusionStrength, ...factor, ...emissive].every(
        Number.isFinite,
      ) ||
      metallic < 0 ||
      metallic > 1 ||
      roughness < 0 ||
      roughness > 1 ||
      cutoff < 0 ||
      occlusionStrength < 0 ||
      occlusionStrength > 1
    )
      fail(`Material ${index} has invalid PBR factors`);
    return {
      name: material.name ?? `Material ${index}`,
      baseColorFactor: factor,
      metallicFactor: metallic,
      roughnessFactor: roughness,
      ...(pbr.baseColorTexture?.index !== undefined
        ? { baseColorTexture: pbr.baseColorTexture.index }
        : {}),
      ...(pbr.metallicRoughnessTexture?.index !== undefined
        ? { metallicRoughnessTexture: pbr.metallicRoughnessTexture.index }
        : {}),
      ...(material.normalTexture?.index !== undefined
        ? { normalTexture: material.normalTexture.index }
        : {}),
      ...(material.occlusionTexture?.index !== undefined
        ? { occlusionTexture: material.occlusionTexture.index }
        : {}),
      ...(material.emissiveTexture?.index !== undefined
        ? { emissiveTexture: material.emissiveTexture.index }
        : {}),
      ...(Object.keys(textureTransforms).length ? { textureTransforms } : {}),
      emissiveFactor: emissive,
      alphaMode: alphaMode as GltfPbrMaterial['alphaMode'],
      alphaCutoff: cutoff,
      doubleSided: material.doubleSided ?? false,
      normalScale,
      occlusionStrength,
    };
  });

  const meshes: GltfMesh[] = (root.meshes ?? []).map((sourceMesh, meshIndex) => {
    abortIfNeeded(signal);
    if (!sourceMesh.primitives?.length) fail(`Mesh ${meshIndex} has no primitives`);
    const primitives = sourceMesh.primitives.map((primitive, primitiveIndex): GltfPrimitive => {
      if ((primitive.mode ?? 4) !== 4)
        fail('Only triangle-list primitives are supported', 'UNSUPPORTED_FEATURE');
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined)
        fail(`Mesh ${meshIndex} primitive ${primitiveIndex} has no POSITION`);
      const positions = readAccessor(root, binary, positionAccessor, 'VEC3') as Float32Array;
      const vertexCount = positions.length / 3;
      if (vertexCount < 3) fail('A triangle primitive requires at least three vertices');
      const indices =
        primitive.indices === undefined
          ? Uint32Array.from({ length: vertexCount }, (_, i) => i)
          : readAccessor(root, binary, primitive.indices, 'SCALAR');
      if (
        indices.length % 3 !== 0 ||
        indices.some((value) => !Number.isInteger(value) || value < 0 || value >= vertexCount)
      ) {
        fail('Primitive indices must reference valid triangle vertices', 'INVALID_ACCESSOR');
      }
      const normals =
        primitive.attributes?.NORMAL === undefined
          ? makeNormals(positions, indices)
          : (readAccessor(root, binary, primitive.attributes.NORMAL, 'VEC3') as Float32Array);
      const uvs =
        primitive.attributes?.TEXCOORD_0 === undefined
          ? undefined
          : (readAccessor(root, binary, primitive.attributes.TEXCOORD_0, 'VEC2') as Float32Array);
      if (normals.length !== positions.length)
        fail('NORMAL accessor count does not match POSITION', 'INVALID_ACCESSOR');
      const mesh: MeshData = {
        positions,
        normals,
        indices: indices instanceof Uint32Array ? indices : Uint32Array.from(indices),
        ...(uvs ? { uvs } : {}),
      };
      try {
        validateMeshData(mesh);
      } catch (error) {
        fail(`Invalid primitive geometry: ${String(error)}`, 'INVALID_ACCESSOR');
      }
      if (
        primitive.material !== undefined &&
        (!Number.isInteger(primitive.material) || !materials[primitive.material])
      ) {
        fail(`Primitive references missing material ${primitive.material}`);
      }
      const material = primitive.material === undefined ? undefined : materials[primitive.material];
      if (
        material &&
        (material.baseColorTexture !== undefined ||
          material.metallicRoughnessTexture !== undefined ||
          material.normalTexture !== undefined ||
          material.occlusionTexture !== undefined ||
          material.emissiveTexture !== undefined) &&
        !uvs
      ) {
        fail(
          `Mesh ${meshIndex} primitive ${primitiveIndex} uses a textured material without TEXCOORD_0`,
          'UNSUPPORTED_FEATURE',
        );
      }
      return { mesh, material: primitive.material ?? null, mode: 4 };
    });
    return { name: sourceMesh.name ?? `Mesh ${meshIndex}`, primitives };
  });

  const nodes: GltfNode[] = (root.nodes ?? []).map((node, index) => {
    if (
      node.matrix &&
      (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined)
    ) {
      fail(`Node ${index} must use either matrix or TRS properties, not both`);
    }
    const transform = node.matrix
      ? decomposeNodeMatrix(node.matrix, index)
      : {
          translation: tuple(node.translation, [0, 0, 0] as const, 3, `node ${index} translation`),
          rotation: tuple(node.rotation, [0, 0, 0, 1] as const, 4, `node ${index} rotation`),
          scale: tuple(node.scale, [1, 1, 1] as const, 3, `node ${index} scale`),
        };
    if (node.mesh !== undefined && !meshes[node.mesh])
      fail(`Node ${index} references missing mesh ${node.mesh}`);
    const children = node.children ?? [];
    if (
      children.some(
        (child) => !Number.isInteger(child) || child < 0 || child >= (root.nodes?.length ?? 0),
      )
    )
      fail(`Node ${index} references an invalid child`);
    return {
      name: node.name ?? `Node ${index}`,
      mesh: node.mesh ?? null,
      children,
      ...transform,
      ...(node.matrix ? { matrix: node.matrix } : {}),
    };
  });

  const images: GltfImageAsset[] = (root.images ?? []).map((image, index) => {
    if (image.uri) fail('External/data URI images are not supported', 'UNSUPPORTED_FEATURE');
    if (image.bufferView === undefined)
      fail(`Image ${index} must use an embedded bufferView`, 'UNSUPPORTED_FEATURE');
    const bufferView = root.bufferViews?.[image.bufferView];
    if (!bufferView || bufferView.buffer !== 0)
      fail(`Image ${index} references an invalid bufferView`);
    if (
      image.mimeType !== 'image/png' &&
      image.mimeType !== 'image/jpeg' &&
      image.mimeType !== 'image/webp'
    ) {
      fail(`Image ${index} has an unsupported or missing MIME type`, 'UNSUPPORTED_FEATURE');
    }
    const start = bufferView.byteOffset ?? 0;
    const end = start + (bufferView.byteLength ?? 0);
    if (!Number.isInteger(start) || start < 0 || end > binary.byteLength || end <= start) {
      fail(`Image ${index} byte range is invalid`);
    }
    return {
      name: image.name ?? `Image ${index}`,
      mimeType: image.mimeType,
      data: binary.slice(start, end),
    };
  });

  const samplers: GltfSampler[] = (root.samplers ?? []).map((sampler, index) => {
    const magFilter = sampler.magFilter ?? null;
    const minFilter = sampler.minFilter ?? null;
    const wrapS = sampler.wrapS ?? 10497;
    const wrapT = sampler.wrapT ?? 10497;
    if (magFilter !== null && ![9728, 9729].includes(magFilter))
      fail(`Sampler ${index} has an invalid magFilter`);
    if (minFilter !== null && ![9728, 9729, 9984, 9985, 9986, 9987].includes(minFilter))
      fail(`Sampler ${index} has an invalid minFilter`);
    if (![wrapS, wrapT].every((value) => [33071, 33648, 10497].includes(value)))
      fail(`Sampler ${index} has an invalid wrap mode`);
    return { magFilter, minFilter, wrapS, wrapT };
  });

  const textures: GltfTextureInfo[] = (root.textures ?? []).map((texture, index) => {
    const image = texture.source === undefined ? undefined : images[texture.source];
    if (texture.source !== undefined && !image) fail(`Texture ${index} references a missing image`);
    if (
      texture.sampler !== undefined &&
      (!Number.isInteger(texture.sampler) || !samplers[texture.sampler])
    ) {
      fail(`Texture ${index} references a missing sampler`);
    }
    return {
      source: texture.source ?? null,
      sampler: texture.sampler ?? null,
      mimeType: image?.mimeType ?? null,
      embedded: image !== undefined,
    };
  });

  for (const [materialIndex, material] of materials.entries()) {
    for (const [channel, textureIndex] of Object.entries({
      baseColor: material.baseColorTexture,
      metallicRoughness: material.metallicRoughnessTexture,
      normal: material.normalTexture,
      occlusion: material.occlusionTexture,
      emissive: material.emissiveTexture,
    })) {
      if (
        textureIndex !== undefined &&
        (!Number.isInteger(textureIndex) || textureIndex < 0 || !textures[textureIndex])
      ) {
        fail(`Material ${materialIndex} ${channel} references missing texture ${textureIndex}`);
      }
    }
  }

  return {
    version: 2,
    generator: root.asset?.generator ?? 'unknown',
    meshes,
    materials,
    nodes,
    images,
    samplers,
    textures,
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
    const startedAt = now();
    abortIfNeeded(context.signal);
    const maxSourceBytes = budgetLimit(context.settings, 'maxSourceBytes', 256 * 1024 * 1024);
    if (source.byteLength > maxSourceBytes)
      fail(
        `GLB source bytes (${source.byteLength}) exceeds the configured import limit (${maxSourceBytes})`,
        'RESOURCE_LIMIT',
      );
    const { root, binary: sourceBinary } = parseGlb(source);
    const parsedAt = now();
    abortIfNeeded(context.signal);
    const budget = validateImportBudget(root, source.byteLength, context.settings);
    const maxDecodedBufferBytes = budgetLimit(
      context.settings,
      'maxDecodedBufferBytes',
      512 * 1024 * 1024,
    );
    const binary = await prepareGlbBuffers(root, sourceBinary, maxDecodedBufferBytes);
    validateGlbBufferViews(root, binary);
    const decodedAt = now();
    abortIfNeeded(context.signal);
    const data = importDocument(root, binary, context.signal);
    const builtAt = now();
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
        sourceBytes: budget.sourceBytes,
        geometryBytes: budget.geometryBytes,
        textureBytes: budget.textureBytes,
        vertexCount: budget.vertexCount,
        triangleCount: budget.triangleCount,
        parseMs: Math.round((parsedAt - startedAt) * 100) / 100,
        decodeMs: Math.round((decodedAt - parsedAt) * 100) / 100,
        buildMs: Math.round((builtAt - decodedAt) * 100) / 100,
        totalMs: Math.round((builtAt - startedAt) * 100) / 100,
      },
    };
  }
}
