import { describe, expect, it } from 'vitest';
import {
  AnimationError,
  AnimationPlayer,
  blendAnimationPoses,
  computeSkinningPalette,
  sampleAnimationTrack,
  validateAnimationClip,
  type AnimationClip,
  type AnimationTrack,
} from './index.js';

const linear: AnimationTrack = {
  targetNode: 2,
  path: 'translation',
  interpolation: 'LINEAR',
  times: new Float32Array([0, 1]),
  values: new Float32Array([0, 0, 0, 10, 0, 0]),
};
const clip: AnimationClip = { name: 'move', duration: 1, tracks: [linear] };

describe('animation sampling', () => {
  it('samples LINEAR values and clamps outside the key range', () => {
    expect([...sampleAnimationTrack(linear, 0.25)]).toEqual([2.5, 0, 0]);
    expect([...sampleAnimationTrack(linear, -2)]).toEqual([0, 0, 0]);
    expect([...sampleAnimationTrack(linear, 3)]).toEqual([10, 0, 0]);
  });

  it('holds the previous value for STEP interpolation', () => {
    const track: AnimationTrack = { ...linear, interpolation: 'STEP' };
    expect([...sampleAnimationTrack(track, 0.99)]).toEqual([0, 0, 0]);
    expect([...sampleAnimationTrack(track, 1)]).toEqual([10, 0, 0]);
  });

  it('normalizes rotation keys even when sampling exactly at a key boundary', () => {
    const track: AnimationTrack = {
      targetNode: 0,
      path: 'rotation',
      interpolation: 'STEP',
      times: new Float32Array([0]),
      values: new Float32Array([0, 0, 0, 2]),
    };
    expect([...sampleAnimationTrack(track, 0)]).toEqual([0, 0, 0, 1]);
  });

  it('uses shortest-path quaternion slerp and normalizes output', () => {
    const track: AnimationTrack = {
      targetNode: 0,
      path: 'rotation',
      interpolation: 'LINEAR',
      times: new Float32Array([0, 1]),
      values: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]),
    };
    const result = sampleAnimationTrack(track, 0.5);
    expect(Math.hypot(...result)).toBeCloseTo(1);
    expect(result[2]).toBeGreaterThan(0.6);
  });

  it('evaluates glTF CUBICSPLINE Hermite values with time-scaled tangents', () => {
    const track: AnimationTrack = {
      targetNode: 0,
      path: 'translation',
      interpolation: 'CUBICSPLINE',
      times: new Float32Array([0, 2]),
      values: new Float32Array([0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0]),
    };
    expect(sampleAnimationTrack(track, 1)[0]).toBeCloseTo(2.5);
  });

  it('rejects duplicate keys, non-finite values and channel times past duration', () => {
    expect(() =>
      sampleAnimationTrack({ ...linear, times: new Float32Array([0, 0]) }, 0),
    ).toThrowError(AnimationError);
    expect(() =>
      sampleAnimationTrack({ ...linear, values: new Float32Array([0, 0, Number.NaN, 1, 0, 0]) }, 0),
    ).toThrowError(AnimationError);
    expect(() => validateAnimationClip({ ...clip, duration: 0.5 })).toThrowError(AnimationError);
  });

  it('blends poses and rejects out-of-range weights', () => {
    const left = new Map([
      [
        0,
        {
          translation: [0, 0, 0] as const,
          rotation: [0, 0, 0, 1] as const,
          scale: [1, 1, 1] as const,
        },
      ],
    ]);
    const right = new Map([
      [
        0,
        {
          translation: [10, 0, 0] as const,
          rotation: [0, 0, 0, 1] as const,
          scale: [3, 1, 1] as const,
        },
      ],
    ]);
    expect(blendAnimationPoses(left, right, 0.25).get(0)?.translation[0]).toBe(2.5);
    expect(blendAnimationPoses(left, right, 0.25).get(0)?.scale[0]).toBe(1.5);
    expect(() => blendAnimationPoses(left, right, 1.1)).toThrowError(AnimationError);
  });
});

describe('AnimationPlayer', () => {
  it('supports play, seek, pause, resume, stop and looping', () => {
    const player = new AnimationPlayer();
    player.play(clip);
    expect(player.update(0.25).get(2)?.translation).toEqual([2.5, 0, 0]);
    player.pause();
    expect(player.update(0.25).get(2)?.translation).toEqual([2.5, 0, 0]);
    player.resume();
    player.update(0.9);
    expect(player.time).toBeCloseTo(0.15);
    player.seek(0.75);
    expect(player.time).toBe(0.75);
    player.seek(-5);
    expect(player.time).toBe(0);
    player.stop();
    expect(player.time).toBe(0);
    expect(player.playing).toBe(false);
  });

  it('cross-fades clips and adopts the target clip at completion', () => {
    const target: AnimationClip = {
      name: 'move-fast',
      duration: 1,
      tracks: [{ ...linear, values: new Float32Array([10, 0, 0, 20, 0, 0]) }],
    };
    const player = new AnimationPlayer();
    player.play(clip, { loop: false });
    player.crossFadeTo(target, 0.5);
    expect(player.update(0.25).get(2)?.translation?.[0]).toBeCloseTo(7.5);
    player.update(0.25);
    expect(player.update(0).get(2)?.translation?.[0]).toBeCloseTo(15);
  });

  it('rejects invalid deltas and use after disposal', () => {
    const player = new AnimationPlayer();
    expect(() => player.update(-1)).toThrowError(AnimationError);
    player.dispose();
    player.dispose();
    expect(() => player.play(clip)).toThrowError(AnimationError);
  });
});

describe('skinning palette', () => {
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  it('computes mesh-relative joint matrices in column-major glTF order', () => {
    const meshWorld = identity.slice();
    meshWorld[12] = 2;
    const jointWorld = identity.slice();
    jointWorld[12] = 5;
    const inverseBind = identity.slice();
    inverseBind[12] = -1;
    const palette = computeSkinningPalette(
      { jointNodeIndices: [7], inverseBindMatrices: inverseBind },
      new Map([[7, jointWorld]]),
      meshWorld,
    );
    expect(palette[12]).toBeCloseTo(2);
    expect([...palette.slice(0, 12)]).toEqual([...identity.slice(0, 12)]);
  });

  it('rejects singular mesh matrices, missing joints and mismatched bind data', () => {
    const singular = new Float32Array(16);
    expect(() =>
      computeSkinningPalette(
        { jointNodeIndices: [0], inverseBindMatrices: identity },
        new Map([[0, identity]]),
        singular,
      ),
    ).toThrowError(AnimationError);
    expect(() =>
      computeSkinningPalette(
        { jointNodeIndices: [0], inverseBindMatrices: identity },
        new Map(),
        identity,
      ),
    ).toThrowError(AnimationError);
    expect(() =>
      computeSkinningPalette(
        { jointNodeIndices: [0, 1], inverseBindMatrices: identity },
        new Map(),
        identity,
      ),
    ).toThrowError(AnimationError);
  });
});
