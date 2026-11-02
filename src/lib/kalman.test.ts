import { describe, it, expect } from 'vitest';
import { kalmanInit, kalmanUpdate, kalmanSpeed, fromState } from './navmath';
import { haversineM } from './geo';

const LAT = 50.11;
const LON = 8.68;
const mToLat = (m: number) => m / 110540;
const mToLon = (m: number) => m / (111320 * Math.cos((LAT * Math.PI) / 180));

describe('Kalman GPS filter', () => {
  it('pins a stationary phone even though every fix jumps around', () => {
    let state = kalmanInit(LON, LAT, 12, 0);
    let out: [number, number] = [LON, LAT];
    // 60 s of fixes at 1 Hz, each ±18 m off the truth in a rotating direction
    for (let i = 1; i <= 60; i++) {
      const r = 18;
      const a = (i / 6) * Math.PI;
      const jLat = LAT + mToLat(r * Math.sin(a));
      const jLon = LON + mToLon(r * Math.cos(a));
      const res = kalmanUpdate(state, jLon, jLat, 12, i * 1000, { speed: 0 });
      state = res.state;
      out = [res.lon, res.lat];
    }
    const error = haversineM([LON, LAT], out);
    expect(error).toBeLessThan(6); // raw jitter is 18 m; the filter must beat it
  });

  it('follows a moving car without lagging far behind', () => {
    // 15 m/s (54 km/h) heading north for 40 s
    let state: ReturnType<typeof kalmanInit> | null = null;
    let pos: [number, number] = [LON, LAT];
    for (let i = 0; i <= 40; i++) {
      const travelled = 15 * i;
      const jLat = LAT + mToLat(travelled + (i % 2 ? 8 : -8)); // ±8 m GPS noise
      const res = kalmanUpdate(state, LON, jLat, 10, i * 1000, { speed: 15 });
      state = res.state;
      pos = [res.lon, res.lat];
    }
    const truth = LAT + mToLat(15 * 40);
    const lagM = haversineM([LON, truth], pos);
    expect(lagM).toBeLessThan(6); // a fixed EMA would trail by tens of metres
  });

  it('estimates speed when the platform reports none', () => {
    let state: ReturnType<typeof kalmanInit> | null = null;
    for (let i = 0; i <= 12; i++) {
      state = kalmanUpdate(state, LON, LAT + mToLat(15 * i), 8, i * 1000).state;
    }
    expect(kalmanSpeed(state!)).toBeGreaterThan(11);
    expect(kalmanSpeed(state!)).toBeLessThan(19);
  });

  it('survives garbage: NaN fixes, zero accuracy, huge gaps', () => {
    let state = kalmanInit(LON, LAT, 10, 0);
    // NaN fix must be ignored
    const r1 = kalmanUpdate(state, NaN, NaN, 10, 1000);
    expect(Number.isFinite(r1.lon) && Number.isFinite(r1.lat)).toBe(true);
    state = r1.state;
    // zero accuracy is treated as a sane default
    const r2 = kalmanUpdate(state, LON, LAT, 0, 2000);
    expect(Number.isFinite(r2.lat)).toBe(true);
    state = r2.state;
    // a 10 minute gap must not explode the covariance or the estimate
    const r3 = kalmanUpdate(state, LON + 0.001, LAT + 0.001, 20, 600_000);
    expect(Number.isFinite(r3.lon) && Number.isFinite(r3.lat)).toBe(true);
    const [fl, fa] = fromState(r3.state);
    expect(Number.isFinite(fl) && Number.isFinite(fa)).toBe(true);
  });

  it('a 200 m jump does not get clamped into nonsense', () => {
    let res = kalmanUpdate(kalmanInit(LON, LAT, 8, 0), LON, LAT + mToLat(200), 8, 1000);
    expect(res.lat).toBeGreaterThan(LAT);
    res = kalmanUpdate(res.state, LON, LAT + mToLat(400), 8, 2000);
    expect(Number.isFinite(res.lat)).toBe(true);
  });
});
