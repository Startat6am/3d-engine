import { describe, expect, it } from 'vitest';
import {
  createBoxGeometry,
  createCylinderGeometry,
  createPlaneGeometry,
  createUvSphereGeometry,
  validateMeshData,
} from './index.js';

describe('primitive geometry', () => {
  it('creates six independent box faces with indexed triangles', () => {
    const mesh = createBoxGeometry();
    expect(mesh.positions).toHaveLength(72);
    expect(mesh.normals).toHaveLength(72);
    expect(mesh.indices).toHaveLength(36);
    expect(Math.max(...mesh.indices)).toBe(23);
  });
  it('applies box dimensions and rejects invalid values', () => {
    const mesh = createBoxGeometry(2, 4, 6);
    expect(Math.max(...mesh.positions)).toBe(3);
    expect(Math.min(...mesh.positions)).toBe(-3);
    expect(() => createBoxGeometry(1, 0, 1)).toThrow(RangeError);
    expect(() => createBoxGeometry(Number.NaN, 1, 1)).toThrow(RangeError);
  });
  it('creates segmented upward-facing planes', () => {
    const mesh = createPlaneGeometry(4, 2, 2, 1);
    expect(mesh.positions).toHaveLength(18);
    expect(mesh.indices).toHaveLength(12);
    expect(Array.from(mesh.normals).every((v, i) => i % 3 !== 1 || v === 1)).toBe(true);
  });
  it('creates UV spheres with normalized normals', () => {
    const mesh = createUvSphereGeometry(2, 8, 4);
    expect(mesh.positions).toHaveLength((8 + 1) * (4 + 1) * 3);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(Math.hypot(mesh.normals[0]!, mesh.normals[1]!, mesh.normals[2]!)).toBeCloseTo(1);
  });
  it('creates cylinders and cones and validates radii', () => {
    const cylinder = createCylinderGeometry();
    expect(cylinder.indices.length).toBeGreaterThan(0);
    const [ia, ib, ic] = Array.from(cylinder.indices.slice(0, 3));
    const point = (index: number) => Array.from(cylinder.positions.slice(index * 3, index * 3 + 3));
    const a = point(ia!),
      b = point(ib!),
      c = point(ic!);
    const ab = b.map((value, i) => value - a[i]!);
    const ac = c.map((value, i) => value - a[i]!);
    const normalZ = ab[0]! * ac[1]! - ab[1]! * ac[0]!;
    expect(normalZ).toBeGreaterThan(0);
    expect(createCylinderGeometry(0, 1, 2).positions.length).toBeGreaterThan(0);
    expect(() => createCylinderGeometry(0, 0)).toThrow(RangeError);
  });
  it('rejects malformed mesh buffers', () => {
    expect(() =>
      validateMeshData({
        positions: new Float32Array([0, 0]),
        normals: new Float32Array([0, 0]),
        indices: new Uint32Array(),
      }),
    ).toThrow(TypeError);
    expect(() =>
      validateMeshData({
        positions: new Float32Array([0, 0, 0]),
        normals: new Float32Array([0, 1, 0]),
        indices: new Uint32Array([1, 0, 0]),
      }),
    ).toThrow(RangeError);
  });
});
