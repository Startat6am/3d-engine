import { describe, expect, it } from 'vitest';
import { resolveVoxelBrushCell } from '../ui/voxelBrush.js';

const chunk = { coordinate: { x: 1, y: -1, z: 0 } };
const settings = { voxelSize: 2, chunkDimensions: { x: 16, y: 16, z: 16 } };

describe('resolveVoxelBrushCell', () => {
  it('paints the cell immediately outside the hit face', () => {
    expect(
      resolveVoxelBrushCell({ point: [32, -31, 1], normal: [0, 1, 0] }, chunk, settings, 'paint'),
    ).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('erases the cell behind the hit face', () => {
    expect(
      resolveVoxelBrushCell({ point: [32, -31, 1], normal: [0, 1, 0] }, chunk, settings, 'erase'),
    ).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects targets outside the chunk and non-axis-aligned normals', () => {
    expect(
      resolveVoxelBrushCell({ point: [32, -31, 1], normal: [0, -1, 0] }, chunk, settings, 'paint'),
    ).toBeNull();
    expect(
      resolveVoxelBrushCell(
        { point: [32, -31, 1], normal: [0.5, 0.5, 0] },
        chunk,
        settings,
        'paint',
      ),
    ).toBeNull();
  });
});
