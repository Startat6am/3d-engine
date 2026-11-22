import { describe, expect, it, vi } from 'vitest';
import {
  AudioError,
  AudioRuntime,
  calculateInverseDistanceGain,
  createAudioSourceState,
  type AudioBackend,
  type AudioClipData,
  type AudioClipHandle,
} from './index.js';

function createBackend(): AudioBackend {
  let next = 0;
  return {
    getCapabilities: () => ({ spatialization: 'HRTF' }),
    activateFromUserGesture: vi.fn(async () => undefined),
    decodeClip: vi.fn(async (data: AudioClipData): Promise<AudioClipHandle> => ({
      id: data.id,
      durationSeconds: 2,
    })),
    createVoice: vi.fn(() => `voice-${++next}`),
    updateListener: vi.fn(() => undefined),
    updateVoice: vi.fn(() => undefined),
    playVoice: vi.fn(() => undefined),
    pauseVoice: vi.fn(() => undefined),
    stopVoice: vi.fn(() => undefined),
    disposeVoice: vi.fn(() => undefined),
    disposeClip: vi.fn(() => undefined),
    dispose: vi.fn(() => undefined),
  };
}

const clipData: AudioClipData = {
  id: 'ambience',
  mimeType: 'audio/wav',
  bytes: new Uint8Array([1, 2, 3]).buffer,
};

describe('spatial audio contracts', () => {
  it('computes inverse-distance attenuation and bypasses it for 2D sources', () => {
    const options = createAudioSourceState([0, 0, 0]);
    expect(calculateInverseDistanceGain([0, 0, 0], [0, 0, 0], options)).toBe(1);
    expect(calculateInverseDistanceGain([2, 0, 0], [0, 0, 0], options)).toBeCloseTo(0.5);
    expect(calculateInverseDistanceGain([100, 0, 0], [0, 0, 0], options)).toBe(0);
    expect(
      calculateInverseDistanceGain([50, 0, 0], [0, 0, 0], { ...options, spatialBlend: 0 }),
    ).toBe(1);
  });

  it('requires explicit user-gesture activation before decoding or creating voices', async () => {
    const backend = createBackend();
    const runtime = new AudioRuntime(backend);
    await expect(runtime.loadClip(clipData)).rejects.toMatchObject({ code: 'CONTEXT_NOT_READY' });
    await runtime.activateFromUserGesture();
    await runtime.loadClip(clipData);
    expect(backend.activateFromUserGesture).toHaveBeenCalledTimes(1);
    expect(backend.decodeClip).toHaveBeenCalledTimes(1);
  });

  it('enforces voice limits and disposes voices/clips/backend idempotently', async () => {
    const backend = createBackend();
    const runtime = new AudioRuntime(backend, { maxVoices: 1 });
    await runtime.activateFromUserGesture();
    await runtime.loadClip(clipData);
    const voice = runtime.createVoice('ambience');
    voice.play();
    voice.pause();
    voice.update(createAudioSourceState([3, 0, 0]));
    expect(() => runtime.createVoice('ambience')).toThrowError(AudioError);
    voice.dispose();
    voice.dispose();
    expect(runtime.voiceCount).toBe(0);
    expect(backend.disposeVoice).toHaveBeenCalledTimes(1);
    runtime.dispose();
    runtime.dispose();
    expect(backend.disposeClip).toHaveBeenCalledTimes(1);
    expect(backend.dispose).toHaveBeenCalledTimes(1);
    expect(() => runtime.createVoice('ambience')).toThrowError(AudioError);
  });

  it('allows a fresh user gesture to resume an already activated backend', async () => {
    const backend = createBackend();
    const runtime = new AudioRuntime(backend);
    await runtime.activateFromUserGesture();
    await runtime.activateFromUserGesture();
    expect(backend.activateFromUserGesture).toHaveBeenCalledTimes(2);
    expect(backend.updateListener).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('caches listener transforms until explicit user-gesture activation', async () => {
    const backend = createBackend();
    const runtime = new AudioRuntime(backend);
    runtime.setListener({ position: [4, 2, 1], orientation: [0, 0, 0, 1] });
    expect(backend.updateListener).not.toHaveBeenCalled();
    await runtime.activateFromUserGesture();
    expect(backend.updateListener).toHaveBeenCalledWith({
      position: [4, 2, 1],
      orientation: [0, 0, 0, 1],
    });
    runtime.dispose();
  });

  it('deduplicates concurrent clip decoding by asset id', async () => {
    const backend = createBackend();
    let finish: ((clip: AudioClipHandle) => void) | undefined;
    vi.mocked(backend.decodeClip).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runtime = new AudioRuntime(backend);
    await runtime.activateFromUserGesture();
    const first = runtime.loadClip(clipData);
    const second = runtime.loadClip(clipData);
    finish?.({ id: 'decoded', durationSeconds: 1 });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(backend.decodeClip).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it('bounds concurrent and queued decodes', async () => {
    const backend = createBackend();
    const finishes: Array<(clip: AudioClipHandle) => void> = [];
    vi.mocked(backend.decodeClip).mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    const runtime = new AudioRuntime(backend, { maxConcurrentDecodes: 1, maxQueuedDecodes: 1 });
    await runtime.activateFromUserGesture();
    const first = runtime.loadClip({ ...clipData, id: 'first' });
    const second = runtime.loadClip({ ...clipData, id: 'second' });
    await expect(runtime.loadClip({ ...clipData, id: 'third' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
    });
    expect(backend.decodeClip).toHaveBeenCalledTimes(1);
    finishes[0]!({ id: 'first', durationSeconds: 1 });
    await first;
    expect(backend.decodeClip).toHaveBeenCalledTimes(2);
    finishes[1]!({ id: 'second', durationSeconds: 1 });
    await second;
    runtime.dispose();
  });

  it('rejects queued decodes on disposal and waits only for active decodes', async () => {
    const backend = createBackend();
    let finish: ((clip: AudioClipHandle) => void) | undefined;
    vi.mocked(backend.decodeClip).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runtime = new AudioRuntime(backend, { maxConcurrentDecodes: 1, maxQueuedDecodes: 1 });
    await runtime.activateFromUserGesture();
    const first = runtime.loadClip({ ...clipData, id: 'active' });
    const queued = runtime.loadClip({ ...clipData, id: 'queued' });
    runtime.dispose();
    await expect(queued).rejects.toMatchObject({ code: 'DISPOSED' });
    expect(backend.dispose).not.toHaveBeenCalled();
    finish?.({ id: 'late', durationSeconds: 1 });
    await expect(first).rejects.toMatchObject({ code: 'DISPOSED' });
    await Promise.resolve();
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight decode cleanup before disposing the backend', async () => {
    const backend = createBackend();
    let finish: ((clip: AudioClipHandle) => void) | undefined;
    vi.mocked(backend.decodeClip).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runtime = new AudioRuntime(backend);
    await runtime.activateFromUserGesture();
    const pending = runtime.loadClip(clipData);
    runtime.dispose();
    expect(backend.dispose).not.toHaveBeenCalled();
    finish?.({ id: 'late-clip', durationSeconds: 1 });
    await expect(pending).rejects.toMatchObject({ code: 'DISPOSED' });
    await Promise.resolve();
    expect(backend.disposeClip).toHaveBeenCalledWith({ id: 'late-clip', durationSeconds: 1 });
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it('enforces encoded byte and decoded duration limits', async () => {
    const backend = createBackend();
    const runtime = new AudioRuntime(backend, { maxClipBytes: 2, maxClipDurationSeconds: 1 });
    await runtime.activateFromUserGesture();
    await expect(runtime.loadClip(clipData)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    vi.mocked(backend.decodeClip).mockResolvedValueOnce({ id: 'long', durationSeconds: 2 });
    await expect(
      runtime.loadClip({ ...clipData, id: 'long', bytes: new Uint8Array([1]).buffer }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    expect(backend.disposeClip).toHaveBeenCalledWith({ id: 'long', durationSeconds: 2 });
    runtime.dispose();
  });

  it('rejects invalid source parameters and unknown clips', async () => {
    const backend = createBackend();
    const runtime = new AudioRuntime(backend);
    await runtime.activateFromUserGesture();
    expect(() => createAudioSourceState([0, 0, 0], { pitch: 0 })).toThrowError(AudioError);
    expect(() => runtime.createVoice('missing')).toThrowError(AudioError);
    runtime.dispose();
  });
});
