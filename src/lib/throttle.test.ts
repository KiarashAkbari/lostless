import { describe, it, expect } from 'vitest';
import { createThrottler } from './throttle';

describe('createThrottler', () => {
  it('serializes calls to at least minIntervalMs apart', async () => {
    const t = createThrottler(() => 40);
    const stamps: number[] = [];
    await Promise.all([t(async () => void stamps.push(Date.now())), t(async () => void stamps.push(Date.now()))]);
    stamps.sort((a, b) => a - b);
    expect(stamps.length).toBe(2);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(35); // timer jitter tolerance
  });

  it('reads the interval lazily (CONFIG mutation / tests take effect)', async () => {
    let interval = 0;
    const t = createThrottler(() => interval);
    const t0 = Date.now();
    await t(async () => {});
    interval = 50;
    await t(async () => {});
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });

  it('propagates the wrapped fn result and errors', async () => {
    const t = createThrottler(() => 0);
    await expect(t(async () => 42)).resolves.toBe(42);
    await expect(t(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
