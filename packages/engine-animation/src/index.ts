export type AnimationPath = 'translation' | 'rotation' | 'scale';
export type AnimationInterpolation = 'STEP' | 'LINEAR' | 'CUBICSPLINE';
export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];

export interface AnimationTrack {
  readonly targetNode: number;
  readonly path: AnimationPath;
  readonly interpolation: AnimationInterpolation;
  readonly times: Float32Array;
  /** Packed VEC3/VEC4 values; CUBICSPLINE stores in/value/out for each key. */
  readonly values: Float32Array;
}

export interface AnimationClip {
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly AnimationTrack[];
}

export interface NodeTransform {
  readonly translation: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export type AnimationPose = ReadonlyMap<number, NodeTransform>;

export type AnimationErrorCode =
  'INVALID_CLIP' | 'INVALID_TRACK' | 'INVALID_TIME' | 'INVALID_WEIGHT' | 'DISPOSED';

export class AnimationError extends Error {
  constructor(
    readonly code: AnimationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AnimationError';
  }
}

const COMPONENTS: Record<AnimationPath, number> = {
  translation: 3,
  rotation: 4,
  scale: 3,
};

function finiteArray(values: Float32Array): boolean {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}

function normalizeQuaternion(value: ArrayLike<number>): Quaternion {
  const length = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
  if (!Number.isFinite(length) || length < 1e-8)
    throw new AnimationError('INVALID_TRACK', 'Animation rotation quaternion must be non-zero');
  return [value[0]! / length, value[1]! / length, value[2]! / length, value[3]! / length];
}

function slerp(a: ArrayLike<number>, b: ArrayLike<number>, alpha: number): Quaternion {
  let bx = b[0]!,
    by = b[1]!,
    bz = b[2]!,
    bw = b[3]!;
  let dot = a[0]! * bx + a[1]! * by + a[2]! * bz + a[3]! * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    return normalizeQuaternion([
      a[0]! + alpha * (bx - a[0]!),
      a[1]! + alpha * (by - a[1]!),
      a[2]! + alpha * (bz - a[2]!),
      a[3]! + alpha * (bw - a[3]!),
    ]);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta);
  const left = Math.sin((1 - alpha) * theta) / sinTheta;
  const right = Math.sin(alpha * theta) / sinTheta;
  return normalizeQuaternion([
    a[0]! * left + bx * right,
    a[1]! * left + by * right,
    a[2]! * left + bz * right,
    a[3]! * left + bw * right,
  ]);
}

export function validateAnimationTrack(track: AnimationTrack): void {
  if (!Number.isSafeInteger(track.targetNode) || track.targetNode < 0)
    throw new AnimationError(
      'INVALID_TRACK',
      'Animation target node must be a non-negative safe integer',
    );
  if (
    !(track.path in COMPONENTS) ||
    !['STEP', 'LINEAR', 'CUBICSPLINE'].includes(track.interpolation)
  )
    throw new AnimationError('INVALID_TRACK', 'Animation path or interpolation is unsupported');
  if (!(track.times instanceof Float32Array) || track.times.length === 0)
    throw new AnimationError(
      'INVALID_TRACK',
      'Animation track requires at least one Float32 key time',
    );
  if (!finiteArray(track.times) || track.times[0]! < 0)
    throw new AnimationError(
      'INVALID_TRACK',
      'Animation key times must be finite and non-negative',
    );
  for (let i = 1; i < track.times.length; i++) {
    if (track.times[i]! <= track.times[i - 1]!)
      throw new AnimationError('INVALID_TRACK', 'Animation key times must be strictly increasing');
  }
  const components = COMPONENTS[track.path];
  const multiplier = track.interpolation === 'CUBICSPLINE' ? 3 : 1;
  if (
    !(track.values instanceof Float32Array) ||
    track.values.length !== track.times.length * components * multiplier
  )
    throw new AnimationError(
      'INVALID_TRACK',
      'Animation values do not match key count, path and interpolation',
    );
  if (!finiteArray(track.values))
    throw new AnimationError('INVALID_TRACK', 'Animation values must be finite');
  if (track.path === 'rotation') {
    const stride = components * multiplier;
    for (let i = 0; i < track.times.length; i++) {
      const offset = i * stride + (track.interpolation === 'CUBICSPLINE' ? 4 : 0);
      normalizeQuaternion(track.values.subarray(offset, offset + 4));
    }
  }
}

export function validateAnimationClip(clip: AnimationClip): void {
  if (!clip.name.trim() || !Number.isFinite(clip.duration) || clip.duration < 0)
    throw new AnimationError(
      'INVALID_CLIP',
      'Animation clip requires a name and finite non-negative duration',
    );
  const targets = new Set<string>();
  for (const track of clip.tracks) {
    validateAnimationTrack(track);
    if (track.times[track.times.length - 1]! > clip.duration + 1e-5)
      throw new AnimationError('INVALID_CLIP', 'Animation track key time exceeds clip duration');
    const key = `${track.targetNode}:${track.path}`;
    if (targets.has(key))
      throw new AnimationError('INVALID_CLIP', `Duplicate animation channel: ${key}`);
    targets.add(key);
  }
}

function keyIndex(times: Float32Array, time: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (times[middle]! <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Sample one validated glTF-style track at clip-local seconds. */
export function sampleAnimationTrack(track: AnimationTrack, time: number): Float32Array {
  validateAnimationTrack(track);
  if (!Number.isFinite(time))
    throw new AnimationError('INVALID_TIME', 'Animation sample time must be finite');
  const times = track.times;
  const components = COMPONENTS[track.path];
  const cubic = track.interpolation === 'CUBICSPLINE';
  const stride = components * (cubic ? 3 : 1);
  const first = keyIndex(times, Math.max(times[0]!, Math.min(times[times.length - 1]!, time)));
  const valueOffset = first * stride + (cubic ? components : 0);
  const output = new Float32Array(components);
  if (first === times.length - 1 || track.interpolation === 'STEP') {
    output.set(track.values.subarray(valueOffset, valueOffset + components));
  } else {
    const second = first + 1;
    const nextOffset = second * stride + (cubic ? components : 0);
    const duration = times[second]! - times[first]!;
    const alpha =
      (Math.max(times[first]!, Math.min(times[second]!, time)) - times[first]!) / duration;
    if (cubic) {
      const outTangent = first * stride + components * 2;
      const inTangent = second * stride;
      const t2 = alpha * alpha;
      const t3 = t2 * alpha;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + alpha;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      for (let c = 0; c < components; c++) {
        output[c] =
          h00 * track.values[valueOffset + c]! +
          h10 * duration * track.values[outTangent + c]! +
          h01 * track.values[nextOffset + c]! +
          h11 * duration * track.values[inTangent + c]!;
      }
    } else if (track.path === 'rotation') {
      output.set(
        slerp(
          track.values.subarray(valueOffset, valueOffset + 4),
          track.values.subarray(nextOffset, nextOffset + 4),
          alpha,
        ),
      );
    } else {
      for (let c = 0; c < components; c++)
        output[c] =
          track.values[valueOffset + c]! +
          (track.values[nextOffset + c]! - track.values[valueOffset + c]!) * alpha;
    }
  }
  if (track.path === 'rotation') output.set(normalizeQuaternion(output));
  return output;
}

export function sampleAnimationClip(
  clip: AnimationClip,
  time: number,
): Map<number, Partial<NodeTransform>> {
  validateAnimationClip(clip);
  if (!Number.isFinite(time))
    throw new AnimationError('INVALID_TIME', 'Animation sample time must be finite');
  const pose = new Map<number, Partial<NodeTransform>>();
  for (const track of clip.tracks) {
    const transform = pose.get(track.targetNode) ?? {};
    const value = sampleAnimationTrack(track, time);
    const updated: Partial<NodeTransform> =
      track.path === 'translation'
        ? { ...transform, translation: [value[0]!, value[1]!, value[2]!] }
        : track.path === 'scale'
          ? { ...transform, scale: [value[0]!, value[1]!, value[2]!] }
          : { ...transform, rotation: normalizeQuaternion(value) };
    pose.set(track.targetNode, updated);
  }
  return pose;
}

export function blendAnimationPoses(
  from: AnimationPose,
  to: AnimationPose,
  weight: number,
): Map<number, NodeTransform> {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1)
    throw new AnimationError('INVALID_WEIGHT', 'Pose blend weight must be between zero and one');
  const result = new Map<number, NodeTransform>();
  const nodes = new Set([...from.keys(), ...to.keys()]);
  for (const node of nodes) {
    const a = from.get(node);
    const b = to.get(node);
    if (!a && b) {
      result.set(node, b);
      continue;
    }
    if (!b && a) {
      result.set(node, a);
      continue;
    }
    const left = a!;
    const right = b!;
    const mix3 = (x: Vec3, y: Vec3): Vec3 => [
      x[0] + (y[0] - x[0]) * weight,
      x[1] + (y[1] - x[1]) * weight,
      x[2] + (y[2] - x[2]) * weight,
    ];
    result.set(node, {
      translation: mix3(left.translation, right.translation),
      scale: mix3(left.scale, right.scale),
      rotation: slerp(left.rotation, right.rotation, weight),
    });
  }
  return result;
}

export class AnimationPlayer {
  #clip: AnimationClip | null = null;
  #time = 0;
  #speed = 1;
  #loop = true;
  #playing = false;
  #disposed = false;
  #fade: { clip: AnimationClip; time: number; elapsed: number; duration: number } | null = null;

  get time(): number {
    return this.#time;
  }
  get playing(): boolean {
    return this.#playing;
  }

  play(
    clip: AnimationClip,
    options: { loop?: boolean; speed?: number; restart?: boolean } = {},
  ): void {
    this.#assertActive();
    validateAnimationClip(clip);
    const speed = options.speed ?? 1;
    if (!Number.isFinite(speed) || speed <= 0)
      throw new AnimationError('INVALID_CLIP', 'Playback speed must be finite and positive');
    this.#clip = clip;
    this.#loop = options.loop ?? true;
    this.#speed = speed;
    if (options.restart ?? true) this.#time = 0;
    this.#fade = null;
    this.#playing = true;
  }

  crossFadeTo(clip: AnimationClip, duration: number): void {
    this.#assertActive();
    validateAnimationClip(clip);
    if (!this.#clip) {
      this.play(clip);
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0)
      throw new AnimationError('INVALID_TIME', 'Cross-fade duration must be positive and finite');
    this.#fade = { clip, time: 0, elapsed: 0, duration };
    this.#playing = true;
  }

  pause(): void {
    this.#assertActive();
    this.#playing = false;
  }
  resume(): void {
    this.#assertActive();
    if (this.#clip) this.#playing = true;
  }
  stop(): void {
    this.#assertActive();
    this.#playing = false;
    this.#time = 0;
    this.#fade = null;
  }
  seek(time: number): void {
    this.#assertActive();
    if (!Number.isFinite(time))
      throw new AnimationError('INVALID_TIME', 'Seek time must be finite');
    if (!this.#clip) {
      this.#time = Math.max(0, time);
      return;
    }
    const clamped = Math.max(0, time);
    this.#time =
      this.#loop && this.#clip.duration > 0
        ? clamped % this.#clip.duration
        : Math.min(this.#clip.duration, clamped);
  }

  update(deltaSeconds: number): Map<number, Partial<NodeTransform>> | Map<number, NodeTransform> {
    this.#assertActive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new AnimationError('INVALID_TIME', 'Animation delta must be finite and non-negative');
    if (!this.#clip) return new Map();
    if (this.#playing) {
      this.#time = this.#advance(
        this.#time,
        deltaSeconds * this.#speed,
        this.#clip.duration,
        this.#loop,
      );
      if (this.#fade) {
        this.#fade.time = this.#advance(
          this.#fade.time,
          deltaSeconds * this.#speed,
          this.#fade.clip.duration,
          this.#loop,
        );
        this.#fade.elapsed += deltaSeconds;
      }
    }
    const current = sampleAnimationClip(this.#clip, this.#time);
    if (!this.#fade) return current;
    const next = sampleAnimationClip(this.#fade.clip, this.#fade.time);
    const weight = Math.min(1, this.#fade.elapsed / this.#fade.duration);
    const blended = this.#blendPartial(current, next, weight);
    if (weight >= 1) {
      this.#clip = this.#fade.clip;
      this.#time = this.#fade.time;
      this.#fade = null;
    }
    return blended;
  }

  dispose(): void {
    this.#disposed = true;
    this.#clip = null;
    this.#fade = null;
    this.#playing = false;
  }

  #advance(time: number, delta: number, duration: number, loop: boolean): number {
    if (duration <= 0) return 0;
    const next = time + delta;
    return loop ? next % duration : Math.min(duration, next);
  }

  #blendPartial(
    a: Map<number, Partial<NodeTransform>>,
    b: Map<number, Partial<NodeTransform>>,
    weight: number,
  ): Map<number, Partial<NodeTransform>> {
    type MutablePartialTransform = { -readonly [K in keyof NodeTransform]?: NodeTransform[K] };
    const result = new Map<number, Partial<NodeTransform>>();
    for (const node of new Set([...a.keys(), ...b.keys()])) {
      const left = a.get(node) ?? {};
      const right = b.get(node) ?? {};
      const merged: MutablePartialTransform = {};
      if (left.translation && right.translation)
        merged.translation = [0, 1, 2].map(
          (i) => left.translation![i]! + (right.translation![i]! - left.translation![i]!) * weight,
        ) as unknown as Vec3;
      else if (right.translation) merged.translation = right.translation;
      else if (left.translation) merged.translation = left.translation;
      if (left.scale && right.scale)
        merged.scale = [0, 1, 2].map(
          (i) => left.scale![i]! + (right.scale![i]! - left.scale![i]!) * weight,
        ) as unknown as Vec3;
      else if (right.scale) merged.scale = right.scale;
      else if (left.scale) merged.scale = left.scale;
      if (left.rotation && right.rotation)
        merged.rotation = slerp(left.rotation, right.rotation, weight);
      else if (right.rotation) merged.rotation = right.rotation;
      else if (left.rotation) merged.rotation = left.rotation;
      result.set(node, merged);
    }
    return result;
  }

  #assertActive(): void {
    if (this.#disposed) throw new AnimationError('DISPOSED', 'Animation player has been disposed');
  }
}
