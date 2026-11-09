import { describe, expect, it } from 'vitest';
import { createBoxGeometry } from './index.js';

describe('createBoxGeometry', () => {
  it('creates six independent faces with indexed triangles', () => {
    const mesh = createBoxGeometry();
    expect(mesh.positions).toHaveLength(72);
    expect(mesh.normals).toHaveLength(72);
    expect(mesh.indices).toHaveLength(36);
    expect(Math.max(...mesh.indices)).toBe(23);
  });

  it('applies dimensions and rejects invalid values', () => {
    const mesh = createBoxGeometry(2, 4, 6);
    expect(Math.max(...mesh.positions)).toBe(3);
    expect(Math.min(...mesh.positions)).toBe(-3);
    expect(() => createBoxGeometry(1, 0, 1)).toThrow(RangeError);
    expect(() => createBoxGeometry(Number.NaN, 1, 1)).toThrow(RangeError);
  });
});
