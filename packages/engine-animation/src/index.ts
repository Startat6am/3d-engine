import { defineComponent, type WorldSystem, type SystemContext } from '@engine/core';

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
  'ANIMATION_INVALID_DATA' | 'ANIMATION_UNSUPPORTED_FEATURE' | 'ANIMATION_RESOURCE_LIMIT';

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
  if (!Object.hasOwn(COMPONENTS, path))
    throw new AnimationDataError(`Unsupported animation path: ${path}`);
  if (!['STEP', 'LINEAR', 'CUBICSPLINE'].includes(interpolation)) {
    throw new AnimationDataError(
      `Unsupported animation interpolation: ${interpolation}`,
      'ANIMATION_UNSUPPORTED_FEATURE',
    );
  }
  if (times.length < 1)
    throw new AnimationDataError('Animation track must contain at least one key');
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
  // Float32 conversion can collapse distinct, closely spaced source timestamps.
  for (let index = 1; index < ownedTimes.length; index++) {
    if (ownedTimes[index]! <= ownedTimes[index - 1]!) {
      throw new AnimationDataError(
        'Animation key times must remain strictly increasing in Float32',
      );
    }
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
  for (let index = 0; index < 4; index++) target[index] = a[index]! * left + b[index]! * right;
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
    throw new AnimationDataError(
      `Animation sample target must contain at least ${track.valueSize} values`,
    );
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
  if (channels.length === 0)
    throw new AnimationDataError('Animation clip must contain at least one channel');
  const targets = new Set<string>();
  let duration = 0;
  for (const channel of channels) {
    if (
      !Number.isSafeInteger(channel.nodeIndex) ||
      channel.nodeIndex < 0 ||
      channel.nodeIndex >= nodeCount
    ) {
      throw new AnimationDataError(
        `Animation channel references invalid node ${channel.nodeIndex}`,
      );
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
  if (joints.length < 1)
    throw new AnimationDataError('Animation skin must contain at least one joint');
  if (joints.length > 256) {
    throw new AnimationDataError(
      'Animation skin exceeds the default 256-joint limit',
      'ANIMATION_RESOURCE_LIMIT',
    );
  }
  const seen = new Set<number>();
  for (let index = 0; index < joints.length; index++) {
    const joint = joints[index]!;
    if (!Number.isSafeInteger(joint) || joint < 0 || joint >= nodeCount) {
      throw new AnimationDataError(`Animation skin references invalid joint node ${joint}`);
    }
    if (seen.has(joint))
      throw new AnimationDataError(`Animation skin contains duplicate joint node ${joint}`);
    seen.add(joint);
  }
  if (inverseBindMatrices.length !== joints.length * 16) {
    throw new AnimationDataError('Inverse bind matrix count must match joint count');
  }
  assertFiniteArray(inverseBindMatrices, 'Inverse bind matrices');
  const matrices = Float32Array.from(inverseBindMatrices);
  if (!matrices.every(Number.isFinite))
    throw new AnimationDataError('Inverse bind matrices exceed Float32 range');
  const skeletonRoot = options.skeletonRoot ?? null;
  if (
    skeletonRoot !== null &&
    (!Number.isSafeInteger(skeletonRoot) || skeletonRoot < 0 || skeletonRoot >= nodeCount)
  ) {
    throw new AnimationDataError(`Animation skin references invalid skeleton root ${skeletonRoot}`);
  }
  return Object.freeze({
    name,
    joints: Uint32Array.from(joints),
    inverseBindMatrices: matrices,
    skeletonRoot,
  });
}

export interface AnimationPoseNode {
  readonly translation: Float32Array;
  readonly rotation: Float32Array;
  readonly scale: Float32Array;
}

export type AnimationPose = AnimationPoseNode[];

function createPoseNode(): AnimationPoseNode {
  return {
    translation: new Float32Array([0, 0, 0]),
    rotation: new Float32Array([0, 0, 0, 1]),
    scale: new Float32Array([1, 1, 1]),
  };
}

/** Creates a mutable local-space pose initialized to glTF TRS defaults. */
export function createAnimationPose(nodeCount: number): AnimationPose {
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
    throw new AnimationDataError('Animation pose node count must be a non-negative safe integer');
  }
  return Array.from({ length: nodeCount }, createPoseNode);
}

function copyPose(source: AnimationPose, target: AnimationPose): void {
  if (source.length !== target.length) throw new AnimationDataError('Animation pose size mismatch');
  for (let index = 0; index < source.length; index++) {
    target[index]!.translation.set(source[index]!.translation);
    target[index]!.rotation.set(source[index]!.rotation);
    target[index]!.scale.set(source[index]!.scale);
  }
}

/** Samples one clip into a reusable local-space pose, preserving untouched bind-pose channels. */
export function evaluateAnimationClip(
  clip: AnimationClip,
  timeSeconds: number,
  bindPose: AnimationPose,
  target: AnimationPose = createAnimationPose(bindPose.length),
): AnimationPose {
  if (target.length !== bindPose.length)
    throw new AnimationDataError('Animation pose size mismatch');
  copyPose(bindPose, target);
  const sample = new Float32Array(4);
  for (const channel of clip.channels) {
    const node = target[channel.nodeIndex];
    if (!node)
      throw new AnimationDataError(
        `Animation channel references missing pose node ${channel.nodeIndex}`,
      );
    const value = sampleAnimationTrack(channel.track, timeSeconds, sample);
    if (channel.track.path === 'translation') node.translation.set(value.subarray(0, 3));
    else if (channel.track.path === 'rotation') node.rotation.set(value.subarray(0, 4));
    else node.scale.set(value.subarray(0, 3));
  }
  return target;
}

function blendPose(
  from: AnimationPose,
  to: AnimationPose,
  alpha: number,
  target: AnimationPose,
): void {
  for (let nodeIndex = 0; nodeIndex < target.length; nodeIndex++) {
    const a = from[nodeIndex]!;
    const b = to[nodeIndex]!;
    const out = target[nodeIndex]!;
    for (let axis = 0; axis < 3; axis++) {
      out.translation[axis] =
        a.translation[axis]! + (b.translation[axis]! - a.translation[axis]!) * alpha;
      out.scale[axis] = a.scale[axis]! + (b.scale[axis]! - a.scale[axis]!) * alpha;
    }
    sampleSlerp(a.rotation, b.rotation, alpha, out.rotation);
  }
}

export interface AnimationPlayOptions {
  readonly loop?: boolean;
  readonly speed?: number;
  readonly restart?: boolean;
}

/** Runtime clip controller with deterministic time advancement and cross-fades. */
export class AnimationPlayer {
  readonly #pose: AnimationPose;
  readonly #bindPose: AnimationPose;
  readonly #clips: ReadonlyMap<string, AnimationClip>;
  #current: AnimationClip | null = null;
  #previous: AnimationClip | null = null;
  #time = 0;
  #previousTime = 0;
  #speed = 1;
  #loop = true;
  #playing = false;
  #fadeDuration = 0;
  #fadeElapsed = 0;
  #previousPose: AnimationPose;
  #currentPose: AnimationPose;

  constructor(clips: readonly AnimationClip[], bindPose: AnimationPose) {
    if (clips.length === 0)
      throw new AnimationDataError('Animation player requires at least one clip');
    const map = new Map<string, AnimationClip>();
    for (const clip of clips) {
      if (map.has(clip.name))
        throw new AnimationDataError(`Duplicate animation clip name: ${clip.name}`);
      map.set(clip.name, clip);
    }
    this.#clips = map;
    this.#bindPose = bindPose.map((node) => ({
      translation: node.translation.slice(),
      rotation: node.rotation.slice(),
      scale: node.scale.slice(),
    }));
    this.#pose = createAnimationPose(bindPose.length);
    this.#previousPose = createAnimationPose(bindPose.length);
    this.#currentPose = createAnimationPose(bindPose.length);
    copyPose(this.#bindPose, this.#pose);
  }

  /** Returns a defensive local-pose snapshot; mutating it cannot alter playback state. */
  get pose(): AnimationPose {
    return this.getPoseSnapshot();
  }
  getPoseSnapshot(): AnimationPose {
    return this.#pose.map((node) => ({
      translation: node.translation.slice(),
      rotation: node.rotation.slice(),
      scale: node.scale.slice(),
    }));
  }

  get currentClip(): string | null {
    return this.#current?.name ?? null;
  }
  get time(): number {
    return this.#time;
  }
  get duration(): number {
    return this.#current?.duration ?? 0;
  }
  get speed(): number {
    return this.#speed;
  }
  get loop(): boolean {
    return this.#loop;
  }
  get playing(): boolean {
    return this.#playing;
  }
  get transitioning(): boolean {
    return this.#previous !== null;
  }

  play(name: string, options: AnimationPlayOptions = {}): void {
    const clip = this.#clips.get(name);
    if (!clip) throw new AnimationDataError(`Unknown animation clip: ${name}`);
    const speed = options.speed ?? this.#speed;
    if (!Number.isFinite(speed) || speed <= 0)
      throw new AnimationDataError('Animation speed must be finite and positive');
    if (this.#current !== clip || options.restart) this.#time = 0;
    this.#current = clip;
    this.#previous = null;
    this.#fadeDuration = 0;
    this.#fadeElapsed = 0;
    this.#loop = options.loop ?? this.#loop;
    this.#speed = speed;
    this.#playing = true;
    this.#evaluate();
  }

  pause(): void {
    this.#playing = false;
  }
  resume(): void {
    if (this.#current) this.#playing = true;
  }
  stop(): void {
    this.#playing = false;
    this.#time = 0;
    this.#previous = null;
    this.#fadeDuration = 0;
    this.#fadeElapsed = 0;
    copyPose(this.#bindPose, this.#pose);
  }

  seek(timeSeconds: number): void {
    if (!Number.isFinite(timeSeconds))
      throw new AnimationDataError('Animation seek time must be finite');
    if (!this.#current) throw new AnimationDataError('Cannot seek before a clip is playing');
    this.#time = this.#normalizeTime(timeSeconds, this.#current);
    this.#evaluate();
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0)
      throw new AnimationDataError('Animation speed must be finite and positive');
    this.#speed = speed;
  }

  crossFadeTo(name: string, durationSeconds: number, options: AnimationPlayOptions = {}): void {
    const next = this.#clips.get(name);
    if (!next) throw new AnimationDataError(`Unknown animation clip: ${name}`);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      throw new AnimationDataError('Cross-fade duration must be finite and non-negative');
    }
    if (!this.#current || durationSeconds === 0) {
      this.play(name, options);
      return;
    }
    const speed = options.speed ?? this.#speed;
    if (!Number.isFinite(speed) || speed <= 0)
      throw new AnimationDataError('Animation speed must be finite and positive');
    this.#previous = this.#current;
    this.#previousTime = this.#time;
    this.#current = next;
    this.#time = 0;
    this.#speed = speed;
    this.#loop = options.loop ?? this.#loop;
    this.#fadeDuration = durationSeconds;
    this.#fadeElapsed = 0;
    this.#playing = true;
    this.#evaluate();
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new AnimationDataError('Animation delta must be finite and non-negative');
    }
    if (!this.#playing || !this.#current || deltaSeconds === 0) return;
    const advance = deltaSeconds * this.#speed;
    this.#time = this.#advanceTime(this.#time, advance, this.#current);
    if (
      !this.#loop &&
      ((advance > 0 && this.#time >= this.#current.duration) || (advance < 0 && this.#time <= 0))
    ) {
      this.#playing = false;
    }
    if (this.#previous) {
      this.#previousTime = this.#advanceTime(this.#previousTime, advance, this.#previous);
      this.#fadeElapsed = Math.min(this.#fadeDuration, this.#fadeElapsed + deltaSeconds);
      if (this.#fadeElapsed >= this.#fadeDuration) this.#previous = null;
    }
    this.#evaluate();
  }

  #normalizeTime(time: number, clip: AnimationClip): number {
    if (clip.duration <= 0) return 0;
    if (this.#loop) return ((time % clip.duration) + clip.duration) % clip.duration;
    return Math.min(clip.duration, Math.max(0, time));
  }

  #advanceTime(time: number, delta: number, clip: AnimationClip): number {
    const next = time + delta;
    if (this.#loop) return this.#normalizeTime(next, clip);
    return Math.min(clip.duration, Math.max(0, next));
  }

  #evaluate(): void {
    if (!this.#current) return;
    evaluateAnimationClip(this.#current, this.#time, this.#bindPose, this.#currentPose);
    if (this.#previous && this.#fadeDuration > 0) {
      evaluateAnimationClip(this.#previous, this.#previousTime, this.#bindPose, this.#previousPose);
      blendPose(
        this.#previousPose,
        this.#currentPose,
        Math.min(1, this.#fadeElapsed / this.#fadeDuration),
        this.#pose,
      );
    } else copyPose(this.#currentPose, this.#pose);
  }
}

export interface AnimationPlayerComponentData {
  readonly player: AnimationPlayer;
}
export const AnimationPlayerComponent =
  defineComponent<AnimationPlayerComponentData>('AnimationPlayer');

/** Advances animation players in ECS variable-update, after fixed simulation ticks. */
export class AnimationPlayerSystem implements WorldSystem {
  readonly phase = 'variable-update' as const;
  update(context: SystemContext): void {
    context.world.query(AnimationPlayerComponent).forEach((_entity, component) => {
      (component as AnimationPlayerComponentData).player.update(context.deltaTime);
    });
  }
}

function composePoseMatrix(pose: AnimationPoseNode): Float64Array {
  const x = pose.rotation[0]!;
  const y = pose.rotation[1]!;
  const z = pose.rotation[2]!;
  const w = pose.rotation[3]!;
  const sx = pose.scale[0]!;
  const sy = pose.scale[1]!;
  const sz = pose.scale[2]!;
  const tx = pose.translation[0]!;
  const ty = pose.translation[1]!;
  const tz = pose.translation[2]!;
  assertFiniteArray(pose.translation, 'Pose translation');
  assertFiniteArray(pose.rotation, 'Pose rotation');
  assertFiniteArray(pose.scale, 'Pose scale');
  const quaternionLength = Math.hypot(x, y, z, w);
  if (quaternionLength <= Number.EPSILON) {
    throw new AnimationDataError('Pose rotation quaternion must be non-zero');
  }
  const qx = x / quaternionLength;
  const qy = y / quaternionLength;
  const qz = z / quaternionLength;
  const qw = w / quaternionLength;
  const x2 = qx * 2,
    y2 = qy * 2,
    z2 = qz * 2;
  const xx = qx * x2,
    xy = qx * y2,
    xz = qx * z2;
  const yy = qy * y2,
    yz = qy * z2,
    zz = qz * z2;
  const wx = qw * x2,
    wy = qw * y2,
    wz = qw * z2;
  return new Float64Array([
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}

function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let index = 0; index < 4; index++) value += a[index * 4 + row]! * b[column * 4 + index]!;
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function invertMat4(matrix: ArrayLike<number>): Float64Array {
  const a = matrix;
  const out = new Float64Array(16);
  const a00 = a[0]!,
    a01 = a[1]!,
    a02 = a[2]!,
    a03 = a[3]!;
  const a10 = a[4]!,
    a11 = a[5]!,
    a12 = a[6]!,
    a13 = a[7]!;
  const a20 = a[8]!,
    a21 = a[9]!,
    a22 = a[10]!,
    a23 = a[11]!;
  const a30 = a[12]!,
    a31 = a[13]!,
    a32 = a[14]!,
    a33 = a[15]!;
  const b00 = a00 * a11 - a01 * a10,
    b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10,
    b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11,
    b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30,
    b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30,
    b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31,
    b11 = a22 * a33 - a23 * a32;
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new AnimationDataError('Cannot evaluate skinning matrices for a singular mesh transform');
  }
  determinant = 1 / determinant;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * determinant;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * determinant;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * determinant;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * determinant;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * determinant;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * determinant;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * determinant;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * determinant;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * determinant;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * determinant;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * determinant;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * determinant;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * determinant;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * determinant;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * determinant;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * determinant;
  return out;
}

/**
 * Evaluates column-major skinning matrices in mesh-local space:
 * inverse(meshWorld) * jointWorld * inverseBindMatrix.
 * Parent indices are node indices; null denotes a root node.
 */
export function evaluateSkinningMatrices(
  pose: AnimationPose,
  parents: readonly (number | null)[],
  skin: AnimationSkin,
  meshNodeIndex?: number,
): Float32Array {
  if (parents.length !== pose.length)
    throw new AnimationDataError('Skeleton parent count must match pose node count');
  if (
    meshNodeIndex !== undefined &&
    (!Number.isSafeInteger(meshNodeIndex) || meshNodeIndex < 0 || meshNodeIndex >= pose.length)
  ) {
    throw new AnimationDataError(`Invalid mesh node index ${meshNodeIndex}`);
  }
  const worldMatrices: Array<Float64Array | undefined> = new Array(pose.length);
  const visiting = new Set<number>();
  const resolve = (nodeIndex: number): Float64Array => {
    const cached = worldMatrices[nodeIndex];
    if (cached) return cached;
    if (visiting.has(nodeIndex))
      throw new AnimationDataError('Skeleton hierarchy contains a cycle');
    visiting.add(nodeIndex);
    const parent = parents[nodeIndex];
    if (
      parent !== null &&
      parent !== undefined &&
      (!Number.isSafeInteger(parent) || parent < 0 || parent >= pose.length)
    ) {
      throw new AnimationDataError(
        `Skeleton node ${nodeIndex} references invalid parent ${parent}`,
      );
    }
    const local = composePoseMatrix(pose[nodeIndex]!);
    const world =
      parent === null || parent === undefined ? local : multiplyMat4(resolve(parent), local);
    visiting.delete(nodeIndex);
    worldMatrices[nodeIndex] = world;
    return world;
  };
  for (let index = 0; index < pose.length; index++) resolve(index);
  const inverseMesh =
    meshNodeIndex === undefined ? null : invertMat4(worldMatrices[meshNodeIndex]!);
  const result = new Float32Array(skin.joints.length * 16);
  for (let jointIndex = 0; jointIndex < skin.joints.length; jointIndex++) {
    const nodeIndex = skin.joints[jointIndex]!;
    if (nodeIndex >= pose.length)
      throw new AnimationDataError(`Skin joint ${nodeIndex} is outside the skeleton pose`);
    let matrix = multiplyMat4(
      worldMatrices[nodeIndex]!,
      skin.inverseBindMatrices.subarray(jointIndex * 16, jointIndex * 16 + 16),
    );
    if (inverseMesh) matrix = multiplyMat4(inverseMesh, matrix);
    for (let element = 0; element < 16; element++) {
      const value = matrix[element]!;
      if (!Number.isFinite(value) || Math.abs(value) > 3.402823466e38) {
        throw new AnimationDataError('Skinning matrix contains a value outside Float32 range');
      }
      result[jointIndex * 16 + element] = value;
    }
  }
  return result;
}
