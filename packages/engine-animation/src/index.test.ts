import { describe, expect, it } from 'vitest';
import {
  AnimationDataError,
  createAnimationClip,
  createAnimationSkin,
  createAnimationTrack,
  sampleAnimationTrack,
} from './index.js';

describe('animation track validation', () => {
  it('copies source data and accepts strictly increasing finite key times', () => {
    const times = [0, 1];
    const values = [0, 0, 0, 1, 0, 0];
    const track = createAnimationTrack({ path: 'translation', times, values });
    times[1] = 9;
    values[3] = 9;
    expect([...track.times]).toEqual([0, 1]);
    expect([...track.values]).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it.each([[[-1, 0]], [[0, 0]], [[1, 0]], [[0, Number.NaN]], [[0, Number.POSITIVE_INFINITY]]])(
    'rejects invalid key times %j',
    (times) => {
      expect(() =>
        createAnimationTrack({ path: 'translation', times, values: [0, 0, 0, 1, 0, 0] }),
      ).toThrow(AnimationDataError);
    },
  );

  it('rejects output counts that do not match path and interpolation', () => {
    expect(() =>
      createAnimationTrack({ path: 'rotation', times: [0, 1], values: [0, 0, 0, 1] }),
    ).toThrow(/output count mismatch/);
  });

  it('rejects non-finite values and Float32 overflow', () => {
    expect(() =>
      createAnimationTrack({ path: 'translation', times: [0], values: [0, Number.NaN, 0] }),
    ).toThrow(/non-finite/);
    expect(() =>
      createAnimationTrack({ path: 'translation', times: [0], values: [0, 0, 1e100] }),
    ).toThrow(/Float32 range/);
  });
});

describe('animation sampling', () => {
  it('uses the first and last key outside the keyed range', () => {
    const track = createAnimationTrack({
      path: 'translation',
      times: [1, 2],
      values: [2, 0, 0, 4, 0, 0],
    });
    expect([...sampleAnimationTrack(track, 0)]).toEqual([2, 0, 0]);
    expect([...sampleAnimationTrack(track, 5)]).toEqual([4, 0, 0]);
  });

  it('samples STEP values and exact key boundaries', () => {
    const track = createAnimationTrack({
      path: 'translation',
      interpolation: 'STEP',
      times: [0, 1],
      values: [1, 2, 3, 4, 5, 6],
    });
    expect([...sampleAnimationTrack(track, 0.999)]).toEqual([1, 2, 3]);
    expect([...sampleAnimationTrack(track, 1)]).toEqual([4, 5, 6]);
  });

  it('linearly interpolates vectors and reuses a caller buffer', () => {
    const track = createAnimationTrack({
      path: 'translation',
      times: [0, 2],
      values: [0, 2, 4, 2, 4, 8],
    });
    const target = new Float32Array(3);
    expect(sampleAnimationTrack(track, 1, target)).toBe(target);
    expect([...target]).toEqual([1, 3, 6]);
  });

  it('uses shortest-path quaternion slerp and normalizes the result', () => {
    const track = createAnimationTrack({
      path: 'rotation',
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, 0, -1],
    });
    const value = sampleAnimationTrack(track, 0.5);
    expect(value[0]).toBeCloseTo(0);
    expect(value[1]).toBeCloseTo(0);
    expect(value[2]).toBeCloseTo(0);
    expect(value[3]).toBeCloseTo(1);
  });

  it('samples cubic spline using glTF Hermite tangents scaled by segment duration', () => {
    const track = createAnimationTrack({
      path: 'translation',
      interpolation: 'CUBICSPLINE',
      times: [0, 2],
      values: [
        0, 0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 2, 0, 0, 0, 0, 0,
      ],
    });
    expect(sampleAnimationTrack(track, 1)[0]).toBeCloseTo(1.5);
  });

  it('rejects invalid sample time and undersized output buffers', () => {
    const track = createAnimationTrack({ path: 'translation', times: [0], values: [0, 0, 0] });
    expect(() => sampleAnimationTrack(track, -1)).toThrow(/sample time/);
    expect(() => sampleAnimationTrack(track, 0, new Float32Array(2))).toThrow(/target/);
  });
});

describe('animation clip and skin validation', () => {
  it('derives clip duration and rejects duplicate node/path channels', () => {
    const track = createAnimationTrack({ path: 'translation', times: [0, 3], values: [0, 0, 0, 1, 0, 0] });
    const clip = createAnimationClip('walk', [{ nodeIndex: 1, track }], 2);
    expect(clip.duration).toBe(3);
    expect(() => createAnimationClip('bad', [{ nodeIndex: 1, track }, { nodeIndex: 1, track }], 2)).toThrow(/Duplicate/);
    expect(() => createAnimationClip('bad', [{ nodeIndex: 2, track }], 2)).toThrow(/invalid node/);
  });

  it('validates joint references and inverse bind matrix count', () => {
    const skin = createAnimationSkin({
      name: 'humanoid',
      joints: [0, 1],
      inverseBindMatrices: new Array(32).fill(0),
      nodeCount: 2,
    });
    expect(skin.joints).toEqual(new Uint32Array([0, 1]));
    expect(() =>
      createAnimationSkin({
        name: 'bad',
        joints: [0, 0],
        inverseBindMatrices: new Array(32).fill(0),
        nodeCount: 2,
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      createAnimationSkin({
        name: 'bad',
        joints: [2],
        inverseBindMatrices: new Array(16).fill(0),
        nodeCount: 2,
      }),
    ).toThrow(/invalid joint/);
  });
});
