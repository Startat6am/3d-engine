import { describe, expect, it } from 'vitest';
import {
  VoxelChunkError,
  createVoxelChunkSnapshot,
  decodeVoxelChunkPayload,
  editVoxelChunk,
  encodeVoxelChunkPayload,
  VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH,
} from './index.js';

const coordinate = { x: -1, y: 0, z: 2 };
const palette = [
  { material: { kind: 'asset' as const, assetId: 'mat:stone' } },
  { material: { kind: 'builtin' as const, key: 'grass' } },
];
const emptyCells = () => new Uint16Array(4096);

function expectVoxelError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(VoxelChunkError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected VoxelChunkError with code ${code}`);
}

describe('voxel chunk snapshots', () => {
  it('creates a frozen snapshot with an owned cell buffer', () => {
    const cells = emptyCells();
    cells[0] = 1;
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells });
    cells[0] = 0;
    expect(snapshot.getCell(0, 0, 0)).toBe(1);
    expect(snapshot.revision).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.palette)).toBe(true);
  });

  it('returns detached cell copies', () => {
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    const copy = snapshot.copyCells();
    copy[0] = 2;
    expect(snapshot.getCell(0, 0, 0)).toBe(0);
  });

  it('uses zero for air and one-based palette references', () => {
    const cells = emptyCells();
    cells[0] = 1;
    cells[1] = 2;
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells });
    expect(snapshot.getCell(0, 0, 0)).toBe(1);
    expect(snapshot.getCell(1, 0, 0)).toBe(2);
    expect(snapshot.getCell(2, 0, 0)).toBe(0);
  });

  it('validates buffer type and fixed cell count', () => {
    expect(() =>
      createVoxelChunkSnapshot({
        coordinate,
        palette,
        cells: new Uint8Array(4096) as never,
      }),
    ).toThrow(VoxelChunkError);
    expect(() =>
      createVoxelChunkSnapshot({ coordinate, palette, cells: new Uint16Array(10) }),
    ).toThrow(VoxelChunkError);
  });

  it('rejects cell references outside the palette', () => {
    const cells = emptyCells();
    cells[12] = 3;
    expect(() => createVoxelChunkSnapshot({ coordinate, palette, cells })).toThrow(
      expect.objectContaining({ code: 'INVALID_CELL_VALUE' }),
    );
  });

  it('rejects duplicate and malformed palette references', () => {
    const duplicate = [...palette, { material: { kind: 'asset' as const, assetId: 'mat:stone' } }];
    expect(() =>
      createVoxelChunkSnapshot({ coordinate, palette: duplicate, cells: emptyCells() }),
    ).toThrow(VoxelChunkError);
    expect(() =>
      createVoxelChunkSnapshot({
        coordinate,
        palette: [{ material: { kind: 'asset', assetId: '' } }],
        cells: emptyCells(),
      }),
    ).toThrow(VoxelChunkError);
  });

  it('rejects invalid revisions and cell coordinates', () => {
    expect(() =>
      createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells(), revision: -1 }),
    ).toThrow(VoxelChunkError);
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    expectVoxelError(() => snapshot.getCell(16, 0, 0), 'INVALID_CELL_COORDINATE');
  });

  it('applies edits immutably and increments one revision per batch', () => {
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    const result = editVoxelChunk(snapshot, [
      { x: 1, y: 2, z: 3, value: 1 },
      { x: 4, y: 5, z: 6, value: 2 },
    ]);
    expect(result.snapshot.revision).toBe(1);
    expect(snapshot.getCell(1, 2, 3)).toBe(0);
    expect(result.snapshot.getCell(1, 2, 3)).toBe(1);
    expect(result.changedBounds).toEqual({
      min: { x: 1, y: 2, z: 3 },
      max: { x: 4, y: 5, z: 6 },
    });
  });

  it('does not increment revision when edits make no change', () => {
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    const result = editVoxelChunk(snapshot, [{ x: 0, y: 0, z: 0, value: 0 }]);
    expect(result.snapshot).toBe(snapshot);
    expect(result.changedBounds).toBeNull();
  });

  it('rejects invalid edit values and revision overflow', () => {
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    expect(() => editVoxelChunk(snapshot, [{ x: 0, y: 0, z: 0, value: 3 }])).toThrow(
      VoxelChunkError,
    );
    const maxRevision = createVoxelChunkSnapshot({
      coordinate,
      palette,
      cells: emptyCells(),
      revision: Number.MAX_SAFE_INTEGER,
    });
    expect(editVoxelChunk(maxRevision, [{ x: 0, y: 0, z: 0, value: 0 }]).snapshot).toBe(
      maxRevision,
    );
    expect(() => editVoxelChunk(maxRevision, [{ x: 0, y: 0, z: 0, value: 1 }])).toThrow(
      VoxelChunkError,
    );
  });
});


describe('voxel chunk payload codec', () => {
  it('round-trips chunk cells with stable little-endian bytes', () => {
    const cells = emptyCells();
    cells[0] = 1;
    cells[4095] = 2;
    const snapshot = createVoxelChunkSnapshot({ coordinate, revision: 17, palette, cells });
    const payload = encodeVoxelChunkPayload(snapshot);
    expect(payload.byteLength).toBe(VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH);
    expect([...payload.slice(0, 2)]).toEqual([1, 0]);
    expect([...payload.slice(-2)]).toEqual([2, 0]);
    const decoded = decodeVoxelChunkPayload(snapshot, payload);
    expect(decoded.coordinate).toEqual(coordinate);
    expect(decoded.revision).toBe(17);
    expect(decoded.palette).toEqual(palette);
    expect(decoded.copyCells()).toEqual(cells);
  });

  it('rejects truncated or oversized payloads', () => {
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    expect(() => decodeVoxelChunkPayload(snapshot, new Uint8Array(10))).toThrow(
      expect.objectContaining({ code: 'INVALID_SERIALIZED_PAYLOAD' }),
    );
    expect(() =>
      decodeVoxelChunkPayload(snapshot, new Uint8Array(VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH + 1)),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SERIALIZED_PAYLOAD' }));
  });

  it('rejects decoded palette indexes that are out of range', () => {
    const snapshot = createVoxelChunkSnapshot({ coordinate, palette, cells: emptyCells() });
    const payload = new Uint8Array(VOXEL_CHUNK_PAYLOAD_BYTE_LENGTH);
    payload[0] = 3;
    expect(() => decodeVoxelChunkPayload(snapshot, payload)).toThrow(
      expect.objectContaining({ code: 'INVALID_CELL_VALUE' }),
    );
  });
});
