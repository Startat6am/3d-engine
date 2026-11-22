import {
  AudioError,
  calculateInverseDistanceGain,
  type AudioBackend,
  type AudioBackendCapabilities,
  type AudioClipData,
  type AudioClipHandle,
  type AudioListenerState,
  type AudioSourceState,
} from './index.js';

interface DecodedClip extends AudioClipHandle {
  readonly buffer: AudioBuffer;
}

interface VoiceRecord {
  readonly clipId: string;
  readonly gain: GainNode;
  readonly panner: PannerNode;
  state: AudioSourceState;
  source: AudioBufferSourceNode | null;
  startedAt: number;
  offset: number;
  playing: boolean;
}

function rotateVector(
  value: readonly [number, number, number],
  quaternion: readonly [number, number, number, number],
): [number, number, number] {
  const [x, y, z] = value;
  const [qx, qy, qz, qw] = quaternion;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
}

/** Browser Web Audio implementation. It creates no AudioContext until explicit activation. */
export class WebAudioBackend implements AudioBackend {
  readonly #clips = new Map<string, DecodedClip>();
  readonly #voices = new Map<string, VoiceRecord>();
  #context: AudioContext | null = null;
  #masterGain: GainNode | null = null;
  #listener: AudioListenerState = {
    position: [0, 0, 0],
    orientation: [0, 0, 0, 1],
  };
  #nextVoiceId = 1;
  #disposed = false;
  #spatialization: AudioBackendCapabilities['spatialization'] = 'HRTF';

  get contextState(): AudioContextState | 'unavailable' {
    return this.#context?.state ?? 'unavailable';
  }

  getCapabilities(): AudioBackendCapabilities {
    return { spatialization: this.#spatialization };
  }

  async activateFromUserGesture(): Promise<void> {
    this.#assertActive();
    if (!this.#context) {
      const Context = globalThis.AudioContext;
      if (!Context) throw new AudioError('CONTEXT_NOT_READY', 'Web Audio API is unavailable');
      this.#context = new Context();
      this.#masterGain = this.#context.createGain();
      this.#masterGain.connect(this.#context.destination);
    }
    await this.#context.resume();
    if (this.#context.state !== 'running')
      throw new AudioError(
        'CONTEXT_NOT_READY',
        'Browser audio context did not enter the running state',
      );
  }

  async decodeClip(data: AudioClipData): Promise<AudioClipHandle> {
    const context = this.#requireContext();
    try {
      const buffer = await context.decodeAudioData(data.bytes.slice(0));
      const decoded: DecodedClip = {
        id: data.id,
        durationSeconds: buffer.duration,
        buffer,
      };
      this.#clips.set(data.id, decoded);
      return { id: decoded.id, durationSeconds: decoded.durationSeconds };
    } catch (cause) {
      throw new AudioError('DECODE_FAILED', `Web Audio could not decode ${data.id}`, { cause });
    }
  }

  createVoice(clip: AudioClipHandle, state: AudioSourceState): string {
    const context = this.#requireContext();
    const decoded = this.#clips.get(clip.id);
    if (!decoded)
      throw new AudioError('INVALID_SOURCE', `Decoded audio clip is missing: ${clip.id}`);
    const gain = context.createGain();
    const panner = context.createPanner();
    try {
      panner.panningModel = 'HRTF';
      this.#spatialization = 'HRTF';
    } catch {
      panner.panningModel = 'equalpower';
      this.#spatialization = 'equalpower';
    }
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0;
    panner.connect(gain);
    gain.connect(this.#masterGain!);
    const id = `web-audio-voice-${this.#nextVoiceId++}`;
    const voice: VoiceRecord = {
      clipId: decoded.id,
      gain,
      panner,
      state,
      source: null,
      startedAt: 0,
      offset: 0,
      playing: false,
    };
    this.#voices.set(id, voice);
    this.#applyVoiceState(voice);
    return id;
  }

  updateListener(listener: AudioListenerState): void {
    this.#listener = listener;
    const context = this.#requireContext();
    const audioListener = context.listener;
    const forward = rotateVector([0, 0, -1], listener.orientation);
    const up = rotateVector([0, 1, 0], listener.orientation);
    const time = context.currentTime;
    audioListener.positionX.setValueAtTime(listener.position[0], time);
    audioListener.positionY.setValueAtTime(listener.position[1], time);
    audioListener.positionZ.setValueAtTime(listener.position[2], time);
    audioListener.forwardX.setValueAtTime(forward[0], time);
    audioListener.forwardY.setValueAtTime(forward[1], time);
    audioListener.forwardZ.setValueAtTime(forward[2], time);
    audioListener.upX.setValueAtTime(up[0], time);
    audioListener.upY.setValueAtTime(up[1], time);
    audioListener.upZ.setValueAtTime(up[2], time);
    for (const voice of this.#voices.values()) this.#applyVoiceState(voice);
  }

  updateVoice(handle: string, state: AudioSourceState): void {
    const voice = this.#voices.get(handle);
    if (!voice) throw new AudioError('INVALID_SOURCE', 'Web Audio voice handle is unavailable');
    const wasPlaying = voice.playing;
    const pitchChanged = voice.state.pitch !== state.pitch;
    if (wasPlaying && pitchChanged) {
      voice.offset = this.#currentOffset(voice);
      this.#stopSource(voice);
      voice.playing = false;
    }
    voice.state = state;
    this.#applyVoiceState(voice);
    if (wasPlaying && pitchChanged) {
      this.playVoice(handle);
    } else if (voice.source) {
      voice.source.loop = state.loop;
      voice.source.playbackRate.setTargetAtTime(
        state.pitch,
        this.#requireContext().currentTime,
        0.015,
      );
    }
  }

  playVoice(handle: string): void {
    const voice = this.#requireVoice(handle);
    const context = this.#requireContext();
    const clip = this.#clips.get(voice.clipId);
    if (!clip)
      throw new AudioError('INVALID_SOURCE', `Decoded audio clip is missing: ${voice.clipId}`);
    this.#stopSource(voice);
    const source = context.createBufferSource();
    source.buffer = clip.buffer;
    source.loop = voice.state.loop;
    source.playbackRate.setValueAtTime(voice.state.pitch, context.currentTime);
    source.connect(voice.panner);
    voice.source = source;
    voice.startedAt = context.currentTime;
    voice.playing = true;
    source.onended = () => {
      if (voice.source !== source) return;
      voice.source = null;
      voice.playing = false;
      if (!voice.state.loop) voice.offset = 0;
    };
    source.start(0, Math.min(voice.offset, Math.max(0, clip.durationSeconds - 0.001)));
  }

  pauseVoice(handle: string): void {
    const voice = this.#requireVoice(handle);
    if (!voice.playing) return;
    voice.offset = this.#currentOffset(voice);
    this.#stopSource(voice);
    voice.playing = false;
  }

  stopVoice(handle: string): void {
    const voice = this.#requireVoice(handle);
    this.#stopSource(voice);
    voice.offset = 0;
    voice.playing = false;
  }

  disposeVoice(handle: string): void {
    const voice = this.#voices.get(handle);
    if (!voice) return;
    this.#stopSource(voice);
    voice.panner.disconnect();
    voice.gain.disconnect();
    this.#voices.delete(handle);
  }

  disposeClip(clip: AudioClipHandle): void {
    this.#clips.delete(clip.id);
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const id of [...this.#voices.keys()]) this.disposeVoice(id);
    this.#clips.clear();
    this.#masterGain?.disconnect();
    const context = this.#context;
    this.#context = null;
    this.#masterGain = null;
    this.#disposed = true;
    if (context && context.state !== 'closed') void context.close();
  }

  #applyVoiceState(voice: VoiceRecord): void {
    const context = this.#requireContext();
    const spatialPosition =
      voice.state.spatialBlend === 0 ? this.#listener.position : voice.state.position;
    const orientation = rotateVector([0, 0, -1], voice.state.orientation);
    const time = context.currentTime;
    voice.panner.positionX.setValueAtTime(spatialPosition[0], time);
    voice.panner.positionY.setValueAtTime(spatialPosition[1], time);
    voice.panner.positionZ.setValueAtTime(spatialPosition[2], time);
    voice.panner.orientationX.setValueAtTime(orientation[0], time);
    voice.panner.orientationY.setValueAtTime(orientation[1], time);
    voice.panner.orientationZ.setValueAtTime(orientation[2], time);
    voice.panner.refDistance = voice.state.referenceDistance;
    voice.panner.maxDistance = voice.state.maxDistance;
    const attenuation = calculateInverseDistanceGain(
      voice.state.position,
      this.#listener.position,
      voice.state,
    );
    const blendGain = 1 - voice.state.spatialBlend + voice.state.spatialBlend * attenuation;
    voice.gain.gain.setTargetAtTime(voice.state.gain * blendGain, time, 0.015);
  }

  #currentOffset(voice: VoiceRecord): number {
    const context = this.#requireContext();
    const clip = this.#clips.get(voice.clipId);
    if (!clip) return 0;
    const elapsed = Math.max(0, context.currentTime - voice.startedAt) * voice.state.pitch;
    const offset = voice.offset + elapsed;
    return voice.state.loop && clip.durationSeconds > 0
      ? offset % clip.durationSeconds
      : Math.min(offset, clip.durationSeconds);
  }

  #stopSource(voice: VoiceRecord): void {
    const source = voice.source;
    if (!source) return;
    voice.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* Already stopped by the browser. */
    }
    source.disconnect();
  }

  #requireVoice(handle: string): VoiceRecord {
    this.#assertActive();
    const voice = this.#voices.get(handle);
    if (!voice) throw new AudioError('INVALID_SOURCE', 'Web Audio voice handle is unavailable');
    return voice;
  }

  #requireContext(): AudioContext {
    this.#assertActive();
    if (!this.#context || this.#context.state === 'closed')
      throw new AudioError('CONTEXT_NOT_READY', 'Activate Web Audio from a user gesture first');
    return this.#context;
  }

  #assertActive(): void {
    if (this.#disposed) throw new AudioError('DISPOSED', 'Web Audio backend has been disposed');
  }
}
