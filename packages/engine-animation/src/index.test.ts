import { describe, expect, it } from 'vitest';
import { SystemScheduler, World } from '@engine/core';
import {
  AnimationDataError,
  AnimationPlayer,
  AnimationPlayerComponent,
  AnimationPlayerSystem,
  createAnimationPose,
  evaluateAnimationClip,
  evaluateSkinningMatrices,
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

  it('rejects timestamps that collapse together when stored as Float32', () => {
    expect(() =>
      createAnimationTrack({
        path: 'translation',
        times: [1, 1 + 1e-8],
        values: [0, 0, 0, 1, 0, 0],
      }),
    ).toThrow(/strictly increasing in Float32/);
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
      values: [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0],
    });
    expect(sampleAnimationTrack(track, 1)[0]).toBeCloseTo(1);
  });

  it('rejects invalid sample time and undersized output buffers', () => {
    const track = createAnimationTrack({ path: 'translation', times: [0], values: [0, 0, 0] });
    expect(() => sampleAnimationTrack(track, -1)).toThrow(/sample time/);
    expect(() => sampleAnimationTrack(track, 0, new Float32Array(2))).toThrow(/target/);
  });
});

describe('animation clip and skin validation', () => {
  it('derives clip duration and rejects duplicate node/path channels', () => {
    const track = createAnimationTrack({
      path: 'translation',
      times: [0, 3],
      values: [0, 0, 0, 1, 0, 0],
    });
    const clip = createAnimationClip('walk', [{ nodeIndex: 1, track }], 2);
    expect(clip.duration).toBe(3);
    expect(() =>
      createAnimationClip(
        'bad',
        [
          { nodeIndex: 1, track },
          { nodeIndex: 1, track },
        ],
        2,
      ),
    ).toThrow(/Duplicate/);
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

describe('animation playback and pose evaluation', () => {
  const makeClip = (name: string, endX: number, endRotation = [0, 0, 0, 1] as number[]) =>
    createAnimationClip(
      name,
      [
        {
          nodeIndex: 0,
          track: createAnimationTrack({
            path: 'translation',
            times: [0, 2],
            values: [0, 0, 0, endX, 0, 0],
          }),
        },
        {
          nodeIndex: 0,
          track: createAnimationTrack({
            path: 'rotation',
            times: [0, 2],
            values: [0, 0, 0, 1, ...endRotation],
          }),
        },
      ],
      1,
    );

  it('evaluates animated channels while retaining untouched bind-pose values', () => {
    const bind = createAnimationPose(1);
    bind[0]!.scale.set([2, 3, 4]);
    const clip = makeClip('move', 4);
    const pose = evaluateAnimationClip(clip, 1, bind);
    expect([...pose[0]!.translation]).toEqual([2, 0, 0]);
    expect([...pose[0]!.scale]).toEqual([2, 3, 4]);
  });

  it('supports play, pause, resume, seek, speed and stop', () => {
    const player = new AnimationPlayer([makeClip('move', 4)], createAnimationPose(1));
    player.play('move', { loop: false, speed: 2 });
    player.update(0.5);
    expect(player.time).toBe(1);
    expect(player.pose[0]!.translation[0]).toBeCloseTo(2);
    player.pause();
    player.update(0.5);
    expect(player.time).toBe(1);
    player.resume();
    player.seek(0.5);
    expect(player.pose[0]!.translation[0]).toBeCloseTo(1);
    player.stop();
    expect(player.time).toBe(0);
    expect(player.playing).toBe(false);
    expect([...player.pose[0]!.translation]).toEqual([0, 0, 0]);
  });

  it('wraps positive playback time deterministically across large deltas', () => {
    const player = new AnimationPlayer([makeClip('move', 4)], createAnimationPose(1));
    player.play('move');
    player.update(2.5);
    expect(player.time).toBeCloseTo(0.5);
    player.update(1);
    expect(player.time).toBeCloseTo(1.5);
  });

  it('cross-fades local translation and rotation and completes at the requested duration', () => {
    const player = new AnimationPlayer(
      [makeClip('from', 2), makeClip('to', 6, [0, 0, 1, 0])],
      createAnimationPose(1),
    );
    player.play('from');
    player.crossFadeTo('to', 1);
    player.update(0.5);
    expect(player.transitioning).toBe(true);
    expect(player.pose[0]!.translation[0]).toBeCloseTo(1);
    expect(Math.hypot(...player.pose[0]!.rotation)).toBeCloseTo(1);
    player.update(0.5);
    expect(player.transitioning).toBe(false);
    expect(player.currentClip).toBe('to');
    expect(player.pose[0]!.translation[0]).toBeCloseTo(3);
  });

  it('returns defensive pose snapshots that cannot mutate playback state', () => {
    const player = new AnimationPlayer([makeClip('move', 4)], createAnimationPose(1));
    player.play('move');
    player.update(0.5);
    const snapshot = player.getPoseSnapshot();
    snapshot[0]!.translation[0] = 999;
    expect(player.pose[0]!.translation[0]).toBeCloseTo(1);
  });

  it('evaluates hierarchical joint matrices relative to the mesh node', () => {
    const pose = createAnimationPose(2);
    pose[0]!.translation.set([10, 0, 0]);
    pose[1]!.translation.set([2, 0, 0]);
    const skin = createAnimationSkin({
      name: 'single-joint',
      joints: [1],
      inverseBindMatrices: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      nodeCount: 2,
    });
    const palette = evaluateSkinningMatrices(pose, [null, 0], skin, 0);
    expect(palette).toHaveLength(16);
    expect(palette[12]).toBeCloseTo(2);
    expect(palette[13]).toBeCloseTo(0);
    expect(palette[14]).toBeCloseTo(0);
  });

  it('rejects cyclic hierarchies, invalid parent indices and singular mesh transforms', () => {
    const pose = createAnimationPose(2);
    const skin = createAnimationSkin({
      name: 'single-joint',
      joints: [1],
      inverseBindMatrices: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      nodeCount: 2,
    });
    expect(() => evaluateSkinningMatrices(pose, [1, 0], skin)).toThrow(/cycle/);
    expect(() => evaluateSkinningMatrices(pose, [null, 3], skin)).toThrow(/invalid parent/);
    pose[0]!.scale.set([0, 1, 1]);
    expect(() => evaluateSkinningMatrices(pose, [null, 0], skin, 0)).toThrow(/singular/);
  });

  it('advances attached players during the ECS variable-update phase', () => {
    const world = new World();
    const entity = world.createEntity();
    const player = new AnimationPlayer([makeClip('move', 4)], createAnimationPose(1));
    player.play('move');
    world.add(entity, AnimationPlayerComponent, { player });
    const scheduler = new SystemScheduler();
    scheduler.add(new AnimationPlayerSystem());
    scheduler.update('variable-update', { world, deltaTime: 0.5, elapsedTime: 0.5 });
    expect(player.time).toBeCloseTo(0.5);
    expect(player.pose[0]!.translation[0]).toBeCloseTo(1);
  });

  it('validates playback names, time deltas, seek and cross-fade durations', () => {
    const player = new AnimationPlayer([makeClip('move', 4)], createAnimationPose(1));
    expect(() => player.play('missing')).toThrow(/Unknown animation clip/);
    expect(() => player.update(-1)).toThrow(/delta/);
    expect(() => player.seek(1)).toThrow(/before a clip/);
    expect(() => player.crossFadeTo('move', -1)).toThrow(/Cross-fade duration/);
    expect(() => player.setSpeed(0)).toThrow(/speed/);
    expect(() => player.setSpeed(-1)).toThrow(/positive/);
  });
});
