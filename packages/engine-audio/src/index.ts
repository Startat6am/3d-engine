export type AudioVec3 = readonly [number, number, number];
export type AudioQuaternion = readonly [number, number, number, number];

export interface AudioClipData {
  readonly id: string;
  readonly mimeType: string;
  readonly bytes: ArrayBuffer;
}

export interface AudioClipHandle {
  readonly id: string;
  readonly durationSeconds: number;
}

export interface AudioListenerState {
  readonly position: AudioVec3;
  readonly orientation: AudioQuaternion;
}

export interface AudioSourceOptions {
  readonly gain?: number;
  readonly pitch?: number;
  readonly loop?: boolean;
  readonly spatialBlend?: number;
  readonly referenceDistance?: number;
  readonly maxDistance?: number;
  readonly rolloff?: number;
}

export interface AudioSourceState extends Required<AudioSourceOptions> {
  readonly position: AudioVec3;
  readonly orientation: AudioQuaternion;
}

export type AudioErrorCode =
  | 'INVALID_SOURCE'
  | 'INVALID_LISTENER'
  | 'DECODE_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'VOICE_LIMIT'
  | 'RESOURCE_LIMIT'
  | 'CONTEXT_NOT_READY'
  | 'DISPOSED';

export class AudioError extends Error {
  constructor(
    readonly code: AudioErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AudioError';
  }
}

export interface AudioBackend {
  /** Must be called explicitly from a user gesture handler in browser hosts. */
  activateFromUserGesture(): Promise<void>;
  decodeClip(data: AudioClipData): Promise<AudioClipHandle>;
  createVoice(clip: AudioClipHandle, state: AudioSourceState): string;
  updateListener(listener: AudioListenerState): void;
  updateVoice(handle: string, state: AudioSourceState): void;
  playVoice(handle: string): void;
  pauseVoice(handle: string): void;
  stopVoice(handle: string): void;
  disposeVoice(handle: string): void;
  disposeClip(clip: AudioClipHandle): void;
  dispose(): void;
}

const DEFAULTS: Required<AudioSourceOptions> = {
  gain: 1,
  pitch: 1,
  loop: false,
  spatialBlend: 1,
  referenceDistance: 1,
  maxDistance: 100,
  rolloff: 1,
};

function finiteVec3(value: AudioVec3): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

function validateOrientation(value: AudioQuaternion): void {
  if (value.length !== 4 || !value.every(Number.isFinite) || Math.hypot(...value) < 1e-8)
    throw new AudioError(
      'INVALID_LISTENER',
      'Audio orientation must be a finite non-zero quaternion',
    );
}

function validateSource(state: AudioSourceState): void {
  if (!finiteVec3(state.position))
    throw new AudioError('INVALID_SOURCE', 'Audio source position must be finite');
  if (
    !Number.isFinite(state.gain) ||
    state.gain < 0 ||
    !Number.isFinite(state.pitch) ||
    state.pitch <= 0
  )
    throw new AudioError(
      'INVALID_SOURCE',
      'Audio gain must be non-negative and pitch must be positive',
    );
  if (!Number.isFinite(state.spatialBlend) || state.spatialBlend < 0 || state.spatialBlend > 1)
    throw new AudioError('INVALID_SOURCE', 'Spatial blend must be between zero and one');
  if (
    !Number.isFinite(state.referenceDistance) ||
    state.referenceDistance <= 0 ||
    !Number.isFinite(state.maxDistance) ||
    state.maxDistance < state.referenceDistance ||
    !Number.isFinite(state.rolloff) ||
    state.rolloff < 0
  )
    throw new AudioError('INVALID_SOURCE', 'Audio distance and rolloff settings are invalid');
  validateOrientation(state.orientation);
}

export function createAudioSourceState(
  position: AudioVec3 = [0, 0, 0],
  options: AudioSourceOptions = {},
): AudioSourceState {
  const state: AudioSourceState = {
    ...DEFAULTS,
    ...options,
    position: [...position] as unknown as AudioVec3,
    orientation: [0, 0, 0, 1],
  };
  validateSource(state);
  return Object.freeze(state);
}

/** Inverse-distance attenuation in linear amplitude; 2D sources bypass attenuation. */
export function calculateInverseDistanceGain(
  source: AudioVec3,
  listener: AudioVec3,
  options: Pick<AudioSourceState, 'spatialBlend' | 'referenceDistance' | 'maxDistance' | 'rolloff'>,
): number {
  if (!finiteVec3(source) || !finiteVec3(listener))
    throw new AudioError('INVALID_SOURCE', 'Audio source and listener positions must be finite');
  if (options.spatialBlend <= 0) return 1;
  const distance = Math.hypot(
    source[0] - listener[0],
    source[1] - listener[1],
    source[2] - listener[2],
  );
  if (distance >= options.maxDistance) return 0;
  if (distance <= options.referenceDistance) return 1;
  return (
    options.referenceDistance /
    (options.referenceDistance + options.rolloff * (distance - options.referenceDistance))
  );
}

export class AudioRuntime {
  readonly #backend: AudioBackend;
  readonly #maxVoices: number;
  readonly #maxClipBytes: number;
  readonly #maxClipDurationSeconds: number;
  readonly #clips = new Map<string, AudioClipHandle>();
  readonly #loading = new Map<string, Promise<AudioClipHandle>>();
  readonly #voices = new Map<string, { readonly handle: string; state: AudioSourceState }>();
  #active = false;
  #disposed = false;
  #nextVoiceId = 1;

  constructor(
    backend: AudioBackend,
    options: { maxVoices?: number; maxClipBytes?: number; maxClipDurationSeconds?: number } = {},
  ) {
    this.#backend = backend;
    this.#maxVoices = options.maxVoices ?? 32;
    this.#maxClipBytes = options.maxClipBytes ?? 64 * 1024 * 1024;
    this.#maxClipDurationSeconds = options.maxClipDurationSeconds ?? 600;
    if (!Number.isSafeInteger(this.#maxVoices) || this.#maxVoices < 1)
      throw new RangeError('Audio maxVoices must be a positive safe integer');
    if (!Number.isSafeInteger(this.#maxClipBytes) || this.#maxClipBytes < 1)
      throw new RangeError('Audio maxClipBytes must be a positive safe integer');
    if (!Number.isFinite(this.#maxClipDurationSeconds) || this.#maxClipDurationSeconds <= 0)
      throw new RangeError('Audio maxClipDurationSeconds must be finite and positive');
  }

  get voiceCount(): number {
    return this.#voices.size;
  }
  get active(): boolean {
    return this.#active;
  }

  /** Host must call this from a trusted user gesture; no implicit autoplay/resume occurs. */
  async activateFromUserGesture(): Promise<void> {
    this.#assertActive();
    if (this.#active) return;
    try {
      await this.#backend.activateFromUserGesture();
      this.#active = true;
    } catch (cause) {
      throw new AudioError(
        'CONTEXT_NOT_READY',
        'Audio backend could not be activated from the user gesture',
        { cause },
      );
    }
  }

  async loadClip(data: AudioClipData): Promise<AudioClipHandle> {
    this.#assertActive();
    if (!this.#active)
      throw new AudioError(
        'CONTEXT_NOT_READY',
        'Activate audio from a user gesture before decoding clips',
      );
    if (!data.id.trim() || !data.mimeType.startsWith('audio/') || data.bytes.byteLength === 0)
      throw new AudioError(
        'UNSUPPORTED_FORMAT',
        'Audio clip requires an id, audio MIME type and non-empty bytes',
      );
    const existing = this.#clips.get(data.id);
    if (existing) return existing;
    const pending = this.#loading.get(data.id);
    if (pending) return pending;
    const load = (async (): Promise<AudioClipHandle> => {
      let clip: AudioClipHandle;
      try {
        clip = await this.#backend.decodeClip(data);
      } catch (cause) {
        throw new AudioError('DECODE_FAILED', `Failed to decode audio clip ${data.id}`, { cause });
      }
      if (this.#disposed) {
        this.#backend.disposeClip(clip);
        throw new AudioError('DISPOSED', 'Audio runtime was disposed while decoding a clip');
      }
      if (!clip.id || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds < 0) {
        this.#backend.disposeClip(clip);
        throw new AudioError(
          'DECODE_FAILED',
          `Audio backend returned invalid decoded clip metadata for ${data.id}`,
        );
      }
      if (clip.durationSeconds > this.#maxClipDurationSeconds) {
        this.#backend.disposeClip(clip);
        throw new AudioError(
          'RESOURCE_LIMIT',
          `Decoded audio clip exceeds the ${this.#maxClipDurationSeconds}-second limit`,
        );
      }
      this.#clips.set(data.id, clip);
      return clip;
    })();
    this.#loading.set(data.id, load);
    try {
      return await load;
    } finally {
      if (this.#loading.get(data.id) === load) this.#loading.delete(data.id);
    }
  }

  createVoice(clipId: string, state = createAudioSourceState()): AudioVoice {
    this.#assertActive();
    if (!this.#active)
      throw new AudioError(
        'CONTEXT_NOT_READY',
        'Activate audio from a user gesture before creating voices',
      );
    const clip = this.#clips.get(clipId);
    if (!clip) throw new AudioError('INVALID_SOURCE', `Audio clip is not loaded: ${clipId}`);
    if (this.#voices.size >= this.#maxVoices)
      throw new AudioError(
        'VOICE_LIMIT',
        `Audio voice limit (${this.#maxVoices}) has been reached`,
      );
    validateSource(state);
    const handle = this.#backend.createVoice(clip, state);
    const id = `${clipId}#${this.#nextVoiceId++}`;
    this.#voices.set(id, { handle, state });
    return new AudioVoice(this, id);
  }

  setListener(listener: AudioListenerState): void {
    this.#assertActive();
    if (!finiteVec3(listener.position))
      throw new AudioError('INVALID_LISTENER', 'Listener position must be finite');
    validateOrientation(listener.orientation);
    this.#backend.updateListener(listener);
  }

  updateVoice(id: string, state: AudioSourceState): void {
    this.#assertActive();
    const voice = this.#voices.get(id);
    if (!voice) throw new AudioError('INVALID_SOURCE', 'Audio voice is no longer available');
    validateSource(state);
    this.#backend.updateVoice(voice.handle, state);
    voice.state = state;
  }

  play(id: string): void {
    this.#requireVoice(id);
    this.#backend.playVoice(this.#voices.get(id)!.handle);
  }
  pause(id: string): void {
    this.#requireVoice(id);
    this.#backend.pauseVoice(this.#voices.get(id)!.handle);
  }
  stop(id: string): void {
    this.#requireVoice(id);
    this.#backend.stopVoice(this.#voices.get(id)!.handle);
  }

  releaseVoice(id: string): void {
    const voice = this.#voices.get(id);
    if (!voice) return;
    this.#backend.stopVoice(voice.handle);
    this.#backend.disposeVoice(voice.handle);
    this.#voices.delete(id);
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const id of [...this.#voices.keys()]) this.releaseVoice(id);
    for (const clip of this.#clips.values()) this.#backend.disposeClip(clip);
    this.#clips.clear();
    this.#active = false;
    this.#disposed = true;
    const pendingLoads = [...this.#loading.values()];
    if (pendingLoads.length === 0) {
      this.#backend.dispose();
    } else {
      // Let pending decodes observe the disposed state and release their clip
      // handles before the backend itself is torn down.
      void Promise.allSettled(pendingLoads).then(() => this.#backend.dispose());
    }
  }

  #requireVoice(id: string): void {
    this.#assertActive();
    if (!this.#voices.has(id))
      throw new AudioError('INVALID_SOURCE', 'Audio voice is no longer available');
  }
  #assertActive(): void {
    if (this.#disposed) throw new AudioError('DISPOSED', 'Audio runtime has been disposed');
  }
}

export class AudioVoice {
  #released = false;
  constructor(
    readonly runtime: AudioRuntime,
    readonly id: string,
  ) {}
  play(): void {
    this.#assertActive();
    this.runtime.play(this.id);
  }
  pause(): void {
    this.#assertActive();
    this.runtime.pause(this.id);
  }
  stop(): void {
    this.#assertActive();
    this.runtime.stop(this.id);
  }
  update(state: AudioSourceState): void {
    this.#assertActive();
    this.runtime.updateVoice(this.id, state);
  }
  dispose(): void {
    if (this.#released) return;
    this.#released = true;
    this.runtime.releaseVoice(this.id);
  }
  #assertActive(): void {
    if (this.#released) throw new AudioError('DISPOSED', 'Audio voice has been disposed');
  }
}
