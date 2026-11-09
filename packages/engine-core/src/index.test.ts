import { describe, expect, it, vi } from 'vitest';
import { EngineHost, EntityRegistry } from './index.js';

describe('EngineHost', () => {
  it('starts in registration order and stops in reverse order', async () => {
    const calls: string[] = [];
    const host = new EngineHost();
    host.register({
      start: () => {
        calls.push('start-a');
      },
      stop: () => {
        calls.push('stop-a');
      },
    });
    host.register({
      start: () => {
        calls.push('start-b');
      },
      stop: () => {
        calls.push('stop-b');
      },
    });
    await host.start();
    expect(host.state).toBe('running');
    await host.stop();
    expect(calls).toEqual(['start-a', 'start-b', 'stop-b', 'stop-a']);
  });

  it('rolls back initialized services after a startup failure', async () => {
    const stop = vi.fn();
    const host = new EngineHost();
    host.register({ start: () => undefined, stop });
    host.register({
      start: () => {
        throw new Error('boom');
      },
    });
    await expect(host.start()).rejects.toThrow('Engine startup failed');
    expect(stop).toHaveBeenCalledOnce();
    expect(host.state).toBe('idle');
  });

  it('disposes idempotently', async () => {
    const dispose = vi.fn();
    const host = new EngineHost();
    host.register({ dispose });
    await host.dispose();
    await host.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.state).toBe('disposed');
  });
});

describe('EntityRegistry', () => {
  it('rejects stale handles after an index is reused', () => {
    const registry = new EntityRegistry();
    const first = registry.create();
    expect(registry.isAlive(first)).toBe(true);
    expect(registry.destroy(first)).toBe(true);
    const second = registry.create();
    expect(second).not.toBe(first);
    expect(registry.isAlive(first)).toBe(false);
    expect(registry.isAlive(second)).toBe(true);
  });

  it('does not alias stale handles after many generations', () => {
    const registry = new EntityRegistry();
    let stale = registry.create();
    for (let generation = 0; generation < 5000; generation++) {
      expect(registry.destroy(stale)).toBe(true);
      stale = registry.create();
    }
    expect(registry.isAlive(stale)).toBe(true);
    expect(registry.isAlive('0:0' as typeof stale)).toBe(false);
  });
});
