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
