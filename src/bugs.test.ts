import { describe, it, expect, vi, afterEach } from 'vitest';
import { circlePolygon, nearestOnPolyline, decodePolyline, haversineM, formatDistance, formatDuration, formatEta, formatCoord } from './lib/geo';
import { CONFIG } from './config';
import { getRoute } from './lib/routing';

/**
 * Regression tests for the "Circle radius cannot be NaN" crash class:
 * flaky sensors / APIs must never produce NaN coordinates or radii that
 * reach Leaflet (L.circle) or MapLibre (setLngLat / GeoJSON).
 */

describe('circlePolygon is NaN-proof', () => {
  it('NaN / null / negative radius falls back to a sane default ring', () => {
    for (const bad of [NaN, null, undefined, -5, Infinity] as unknown as number[]) {
      const ring = circlePolygon([8.68, 50.11], bad);
      expect(ring.length).toBe(41);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [lo, la] of ring) {
        expect(Number.isFinite(lo)).toBe(true);
        expect(Number.isFinite(la)).toBe(true);
      }
    }
  });
  it('garbage center becomes [0,0], radius is clamped', () => {
    const ring = circlePolygon([NaN, NaN], 1e12);
    for (const [lo, la] of ring) {
      expect(Number.isFinite(lo)).toBe(true);
      expect(Number.isFinite(la)).toBe(true);
      expect(Math.abs(lo)).toBeLessThan(1); // clamped to 50 km max, around 0
    }
  });
});

describe('nearestOnPolyline is safe on degenerate input', () => {
  it('empty polyline → Infinity distance, finite point', () => {
    const r = nearestOnPolyline([], [8.68, 50.11]);
    expect(r.distM).toBe(Infinity);
    expect(Number.isFinite(r.point[0])).toBe(true);
    expect(Number.isFinite(r.point[1])).toBe(true);
  });
  it('single point polyline does not throw', () => {
    const r = nearestOnPolyline([[8.68, 50.11]], [8.69, 50.12]);
    expect(Number.isFinite(r.point[0])).toBe(true);
  });
  it('NaN query point is handled', () => {
    const r = nearestOnPolyline([[8.68, 50.11], [8.69, 50.12]], [NaN, 50.11]);
    expect(r.distM).toBe(Infinity);
  });
  it('polyline with NaN vertices is skipped, not crashing', () => {
    const r = nearestOnPolyline([[8.68, 50.11], [NaN, NaN], [8.7, 50.13]], [8.69, 50.12]);
    expect(Number.isFinite(r.distM) || r.distM === Infinity).toBe(true);
    expect(Number.isFinite(r.point[0])).toBe(true);
  });
});

describe('decodePolyline never emits NaN', () => {
  it('empty / garbage strings', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(undefined as unknown as string)).toEqual([]);
    const coords = decodePolyline('_ibE_seK_??_u{hC');
    for (const c of coords) {
      expect(Number.isFinite(c[0])).toBe(true);
      expect(Number.isFinite(c[1])).toBe(true);
    }
  });
});

describe('haversineM + formatters never return NaN', () => {
  it('haversineM with non-finite input → Infinity', () => {
    expect(haversineM([NaN, 0], [1, 1])).toBe(Infinity);
    expect(haversineM([8.68, 50.11], [8.69, 50.12])).toBeGreaterThan(1000);
  });
  it('formatters degrade to dashes on garbage', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(Infinity)).toBe('—');
    expect(formatDistance(-3)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
    expect(formatEta(NaN)).toBe('--:--');
    expect(formatCoord(NaN, 8.68)).toBe('—');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDuration(780)).toBe('13 min');
  });
});

describe('routing rejects empty/garbage shapes instead of crashing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('valhalla empty shape → clean error, no NaN coords', async () => {
    (CONFIG.routing as { minIntervalMs: number }).minIntervalMs = 0;
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ trip: { summary: { length: 0, time: 0 }, legs: [{ shape: '', maneuvers: [] }] } }),
    }));
    await expect(getRoute('car', [8.68, 50.11], [8.69, 50.12])).rejects.toThrow(/empty\/invalid/);
  });

  it('valhalla NaN summary → zeroed, not NaN', async () => {
    (CONFIG.routing as { minIntervalMs: number }).minIntervalMs = 0;
    // valid 2-point shape: (50.11,8.68)→(50.12,8.69) in polyline6
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        trip: {
          summary: { length: NaN, time: undefined },
          legs: [{ shape: '_ibE_SeK_??_', maneuvers: [{ instruction: 'Go', time: NaN, type: 0, begin_shape_index: 0 }] }],
        },
      }),
    }));
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    expect(r.distanceM).toBe(0);
    expect(r.durationS).toBe(0);
    expect(r.steps[0].durationS).toBe(0);
    for (const c of r.coords) expect(Number.isFinite(c[0]) && Number.isFinite(c[1])).toBe(true);
  });
});
