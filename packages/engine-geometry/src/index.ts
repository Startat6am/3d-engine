export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

/** A renderer-independent CPU mesh primitive. */
export function createBoxGeometry(width = 1, height = 1, depth = 1): MeshData {
  if (![width, height, depth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Box dimensions must be finite positive numbers');
  }
  const x = width / 2,
    y = height / 2,
    z = depth / 2;
  const faces: readonly (readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ])[] = [
    [-x, -y, z, x, -y, z, x, y, z, -x, y, z],
    [x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z],
    [-x, y, z, x, y, z, x, y, -z, -x, y, -z],
    [-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z],
    [x, -y, z, x, -y, -z, x, y, -z, x, y, z],
    [-x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z],
  ];
  const normals = [
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
  ];
  const positions: number[] = [],
    normalData: number[] = [],
    indices: number[] = [];
  faces.forEach((face, faceIndex) => {
    const base = faceIndex * 4;
    for (let vertex = 0; vertex < 4; vertex++) {
      positions.push(face[vertex * 3]!, face[vertex * 3 + 1]!, face[vertex * 3 + 2]!);
      normalData.push(...normals[faceIndex]!);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normalData),
    indices: new Uint32Array(indices),
  };
}

/** A flat XZ plane with upward-facing normals and a centered origin. */
export function createPlaneGeometry(width = 1, depth = 1, segmentsX = 1, segmentsZ = 1): MeshData {
  assertPositiveDimensions([width, depth]);
  assertSegments(segmentsX, segmentsZ);
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  for (let z = 0; z <= segmentsZ; z++) {
    for (let x = 0; x <= segmentsX; x++) {
      positions.push((x / segmentsX - 0.5) * width, 0, (z / segmentsZ - 0.5) * depth);
      normals.push(0, 1, 0);
    }
  }
  const stride = segmentsX + 1;
  for (let z = 0; z < segmentsZ; z++)
    for (let x = 0; x < segmentsX; x++) {
      const a = z * stride + x,
        b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return mesh(positions, normals, indices);
}

/** UV sphere with duplicated seam and pole vertices for stable texture coordinates. */
export function createUvSphereGeometry(radius = 0.5, segments = 24, rings = 16): MeshData {
  assertPositiveDimensions([radius]);
  assertSegments(segments, rings);
  if (segments < 3 || rings < 2)
    throw new RangeError('Sphere requires at least 3 segments and 2 rings');
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings,
      phi = v * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments,
        theta = u * Math.PI * 2;
      const nx = -Math.cos(theta) * Math.sin(phi),
        ny = Math.cos(phi),
        nz = Math.sin(theta) * Math.sin(phi);
      normals.push(nx, ny, nz);
      positions.push(nx * radius, ny * radius, nz * radius);
    }
  }
  const stride = segments + 1;
  for (let y = 0; y < rings; y++)
    for (let x = 0; x < segments; x++) {
      const a = y * stride + x,
        b = a + stride;
      if (y !== 0) indices.push(a, b, a + 1);
      if (y !== rings - 1) indices.push(b, b + 1, a + 1);
    }
  return mesh(positions, normals, indices);
}

/** Cylinder aligned to Y; radiusTop=radiusBottom produces a cylinder, zero top produces a cone. */
export function createCylinderGeometry(
  radiusTop = 0.5,
  radiusBottom = 0.5,
  height = 1,
  radialSegments = 24,
  heightSegments = 1,
): MeshData {
  assertPositiveDimensions([height]);
  if (
    ![radiusTop, radiusBottom].every((v) => Number.isFinite(v) && v >= 0) ||
    radiusTop + radiusBottom === 0
  )
    throw new RangeError('Cylinder radii must be finite, non-negative, and not both zero');
  assertSegments(radialSegments, heightSegments);
  if (radialSegments < 3) throw new RangeError('Cylinder requires at least 3 radial segments');
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  for (let y = 0; y <= heightSegments; y++) {
    const t = y / heightSegments,
      radius = radiusBottom + (radiusTop - radiusBottom) * t;
    for (let x = 0; x <= radialSegments; x++) {
      const theta = (x / radialSegments) * Math.PI * 2,
        nx = Math.sin(theta),
        nz = Math.cos(theta);
      positions.push(radius * nx, (t - 0.5) * height, radius * nz);
      const slope = (radiusBottom - radiusTop) / height;
      const length = Math.hypot(nx, slope, nz);
      normals.push(nx / length, slope / length, nz / length);
    }
  }
  const stride = radialSegments + 1;
  for (let y = 0; y < heightSegments; y++)
    for (let x = 0; x < radialSegments; x++) {
      const a = y * stride + x,
        b = a + stride;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  return mesh(positions, normals, indices);
}

/** Validate CPU mesh buffers before handing them to a renderer or serializer. */
export function validateMeshData(data: MeshData): void {
  if (data.positions.length % 3 !== 0 || data.normals.length !== data.positions.length)
    throw new TypeError('Mesh positions and normals must contain matching XYZ triples');
  const vertexCount = data.positions.length / 3;
  if (data.indices.length % 3 !== 0) throw new TypeError('Mesh indices must describe triangles');
  for (const value of data.positions)
    if (!Number.isFinite(value)) throw new TypeError('Mesh positions must be finite');
  for (const value of data.normals)
    if (!Number.isFinite(value)) throw new TypeError('Mesh normals must be finite');
  for (const index of data.indices)
    if (index >= vertexCount)
      throw new RangeError(`Mesh index ${index} exceeds vertex count ${vertexCount}`);
}

function mesh(positions: number[], normals: number[], indices: number[]): MeshData {
  const result = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
  validateMeshData(result);
  return result;
}
function assertPositiveDimensions(values: readonly number[]): void {
  if (!values.every((v) => Number.isFinite(v) && v > 0))
    throw new RangeError('Geometry dimensions must be finite positive numbers');
}
function assertSegments(...values: readonly number[]): void {
  if (!values.every((v) => Number.isInteger(v) && v >= 1 && v <= 512))
    throw new RangeError('Geometry segment counts must be integers between 1 and 512');
}
