export type AnimationPath = 'translation' | 'rotation' | 'scale';
export type AnimationInterpolation = 'STEP' | 'LINEAR' | 'CUBICSPLINE';
export type AnimationValueSize = 3 | 4;

export interface AnimationTrack {
  readonly path: AnimationPath;
  readonly interpolation: AnimationInterpolation;
  readonly valueSize: AnimationValueSize;
  /** Key times in seconds, strictly increasing. */
  readonly times: Float32Array;
  /** Packed key values; CUBICSPLINE stores in/value/out triplets per key. */
  readonly values: Float32Array;
}

export interface AnimationChannel {
  readonly nodeIndex: number;
  readonly track: AnimationTrack;
}

export interface AnimationClip {
  readonly name: string;
  readonly duration: number;
  readonly channels: readonly AnimationChannel[];
}

export interface AnimationSkin {
  readonly name: string;
  /** Node indices in the exact joint order used by glTF skin.joints. */
  readonly joints: Uint32Array;
  /** Column-major MAT4 inverse bind matrices, one per joint. */
  readonly inverseBindMatrices: Float32Array;
  readonly skeletonRoot: number | null;
}

export type AnimationDataErrorCode =
  | 'ANIMATION_INVALID_DATA'
  | 'ANIMATION_UNSUPPORTED_FEATURE'
  | 'ANIMATION_RESOURCE_LIMIT';

export class AnimationDataError extends Error {
  constructor(
    message: string,
    readonly code: AnimationDataErrorCode = 'ANIMATION_INVALID_DATA',
  ) {
    super(message);
    this.name = 'AnimationDataError';
  }
}

const COMPONENTS: Readonly<Record<AnimationPath, AnimationValueSize>> = {
  translation: 3,
  rotation: 4,
  scale: 3,
};

function assertFiniteArray(values: ArrayLike<number>, label: string): void {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) {
      throw new AnimationDataError(`${label} contains a non-finite value at index ${index}`);
    }
  }
}

/** Validates and copies untrusted animation channel data into owned typed arrays. */
export function createAnimationTrack(options: {
  readonly path: AnimationPath;
  readonly times: ArrayLike<number>;
  readonly values: ArrayLike<number>;
  readonly interpolation?: AnimationInterpolation;
}): AnimationTrack {
  const { path, times, values } = options;
  const interpolation = options.interpolation ?? 'LINEAR';
  if (!(path in COMPONENTS)) throw new AnimationDataError(`Unsupported animation path: ${path}`);
  if (!['STEP', 'LINEAR', 'CUBICSPLINE'].includes(interpolation)) {
    throw new AnimationDataError(
      `Unsupported animation interpolation: ${interpolation}`,
      'ANIMATION_UNSUPPORTED_FEATURE',
    );
  }
  if (times.length < 1) throw new AnimationDataError('Animation track must contain at least one key');
  assertFiniteArray(times, 'Animation key times');
  assertFiniteArray(values, 'Animation output values');

  for (let index = 0; index < times.length; index++) {
    if (times[index]! < 0) throw new AnimationDataError('Animation key times must be non-negative');
    if (index > 0 && times[index]! <= times[index - 1]!) {
      throw new AnimationDataError('Animation key times must be strictly increasing');
    }
  }

  const valueSize = COMPONENTS[path];
  const elementsPerKey = valueSize * (interpolation === 'CUBICSPLINE' ? 3 : 1);
  if (values.length !== times.length * elementsPerKey) {
    throw new AnimationDataError(
      `Animation output count mismatch: expected ${times.length * elementsPerKey}, received ${values.length}`,
    );
  }

  const ownedTimes = Float32Array.from(times);
  const ownedValues = Float32Array.from(values);
  if (!ownedTimes.every(Number.isFinite) || !ownedValues.every(Number.isFinite)) {
    throw new AnimationDataError('Animation values exceed Float32 range');
  }
  return Object.freeze({ path, interpolation, valueSize, times: ownedTimes, values: ownedValues });
}

function normalizeQuaternion(target: Float32Array): void {
  const length = Math.hypot(target[0]!, target[1]!, target[2]!, target[3]!);
  if (length <= Number.EPSILON) {
    target[0] = 0;
    target[1] = 0;
    target[2] = 0;
    target[3] = 1;
    return;
  }
  for (let index = 0; index < 4; index++) target[index] = target[index]! / length;
}

function sampleSlerp(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  alpha: number,
  target: Float32Array,
): void {
  let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.max(-1, dot * sign));
  if (dot > 0.9995) {
    for (let index = 0; index < 4; index++)
      target[index] = a[index]! + (b[index]! * sign - a[index]!) * alpha;
    normalizeQuaternion(target);
    return;
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const left = Math.sin((1 - alpha) * theta) / sinTheta;
  const right = (Math.sin(alpha * theta) / sinTheta) * sign;
  for (let index = 0; index < 4; index++)
    target[index] = a[index]! * left + b[index]! * right;
  normalizeQuaternion(target);
}

/**
 * Samples a track at clip-local time. The caller may provide a reusable output
 * buffer to avoid per-frame allocations. Exact key times return that key.
 */
export function sampleAnimationTrack(
  track: AnimationTrack,
  timeSeconds: number,
  target = new Float32Array(track.valueSize),
): Float32Array {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new AnimationDataError('Animation sample time must be finite and non-negative');
  }
  if (target.length < track.valueSize) {
    throw new AnimationDataError(`Animation sample target must contain at least ${track.valueSize} values`);
  }

  const { times, values, valueSize, interpolation, path } = track;
  let right = 0;
  while (right < times.length && times[right]! <= timeSeconds) right++;
  const left = Math.max(0, right - 1);
  if (right === 0 || right >= times.length || interpolation === 'STEP') {
    const key = right === 0 ? 0 : left;
    const offset = key * valueSize * (interpolation === 'CUBICSPLINE' ? 3 : 1);
    const valueOffset = offset + (interpolation === 'CUBICSPLINE' ? valueSize : 0);
    for (let index = 0; index < valueSize; index++) target[index] = values[valueOffset + index]!;
    if (path === 'rotation') normalizeQuaternion(target);
    return target;
  }

  const leftTime = times[left]!;
  const rightTime = times[right]!;
  const duration = rightTime - leftTime;
  const alpha = (timeSeconds - leftTime) / duration;
  if (interpolation === 'LINEAR') {
    const leftOffset = left * valueSize;
    const rightOffset = right * valueSize;
    if (path === 'rotation') {
      sampleSlerp(
        values.subarray(leftOffset, leftOffset + valueSize),
        values.subarray(rightOffset, rightOffset + valueSize),
        alpha,
        target,
      );
    } else {
      for (let index = 0; index < valueSize; index++) {
        const start = values[leftOffset + index]!;
        target[index] = start + (values[rightOffset + index]! - start) * alpha;
      }
    }
    return target;
  }

  const leftOffset = left * valueSize * 3;
  const rightOffset = right * valueSize * 3;
  const t2 = alpha * alpha;
  const t3 = t2 * alpha;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + alpha;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  for (let index = 0; index < valueSize; index++) {
    const p0 = values[leftOffset + valueSize + index]!;
    const m0 = values[leftOffset + valueSize * 2 + index]!;
    const p1 = values[rightOffset + valueSize + index]!;
    const m1 = values[rightOffset + index]!;
    target[index] = h00 * p0 + h10 * duration * m0 + h01 * p1 + h11 * duration * m1;
  }
  if (path === 'rotation') normalizeQuaternion(target);
  return target;
}

export function createAnimationClip(
  name: string,
  channels: readonly AnimationChannel[],
  nodeCount: number,
): AnimationClip {
  if (!name.trim()) throw new AnimationDataError('Animation clip name must not be empty');
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
    throw new AnimationDataError('Animation node count must be a non-negative safe integer');
  }
  if (channels.length === 0) throw new AnimationDataError('Animation clip must contain at least one channel');
  const targets = new Set<string>();
  let duration = 0;
  for (const channel of channels) {
    if (!Number.isSafeInteger(channel.nodeIndex) || channel.nodeIndex < 0 || channel.nodeIndex >= nodeCount) {
      throw new AnimationDataError(`Animation channel references invalid node ${channel.nodeIndex}`);
    }
    const key = `${channel.nodeIndex}:${channel.track.path}`;
    if (targets.has(key)) throw new AnimationDataError(`Duplicate animation target ${key}`);
    targets.add(key);
    duration = Math.max(duration, channel.track.times[channel.track.times.length - 1]!);
  }
  return Object.freeze({ name, duration, channels: Object.freeze([...channels]) });
}

export function createAnimationSkin(options: {
  readonly name: string;
  readonly joints: ArrayLike<number>;
  readonly inverseBindMatrices: ArrayLike<number>;
  readonly skeletonRoot?: number | null;
  readonly nodeCount: number;
}): AnimationSkin {
  const { name, joints, inverseBindMatrices, nodeCount } = options;
  if (!name.trim()) throw new AnimationDataError('Animation skin name must not be empty');
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
    throw new AnimationDataError('Animation node count must be a non-negative safe integer');
  }
  if (joints.length < 1) throw new AnimationDataError('Animation skin must contain at least one joint');
  if (joints.length > 256) {
    throw new AnimationDataError('Animation skin exceeds the default 256-joint limit', 'ANIMATION_RESOURCE_LIMIT');
  }
  const seen = new Set<number>();
  for (let index = 0; index < joints.length; index++) {
    const joint = joints[index]!;
    if (!Number.isSafeInteger(joint) || joint < 0 || joint >= nodeCount) {
      throw new AnimationDataError(`Animation skin references invalid joint node ${joint}`);
    }
    if (seen.has(joint)) throw new AnimationDataError(`Animation skin contains duplicate joint node ${joint}`);
    seen.add(joint);
  }
  if (inverseBindMatrices.length !== joints.length * 16) {
    throw new AnimationDataError('Inverse bind matrix count must match joint count');
  }
  assertFiniteArray(inverseBindMatrices, 'Inverse bind matrices');
  const matrices = Float32Array.from(inverseBindMatrices);
  if (!matrices.every(Number.isFinite)) throw new AnimationDataError('Inverse bind matrices exceed Float32 range');
  const skeletonRoot = options.skeletonRoot ?? null;
  if (skeletonRoot !== null && (!Number.isSafeInteger(skeletonRoot) || skeletonRoot < 0 || skeletonRoot >= nodeCount)) {
    throw new AnimationDataError(`Animation skin references invalid skeleton root ${skeletonRoot}`);
  }
  return Object.freeze({
    name,
    joints: Uint32Array.from(joints),
    inverseBindMatrices: matrices,
    skeletonRoot,
  });
}
