import { describe, it, expect } from 'vitest';
import { haversineM, nearestOnPolyline, decodePolyline, formatDistance, formatDuration, formatEta } from './geo';

describe('haversineM', () => {
  it('Frankfurt → Paris is ≈ 478 km', () => {
    const d = haversineM([8.6821, 50.1109], [2.3522, 48.8566]);
    expect(d).toBeGreaterThan(470_000);
    expect(d).toBeLessThan(490_000);
  });
  it('zero for identical points', () => {
    expect(haversineM([1, 1], [1, 1])).toBe(0);
  });
});

describe('nearestOnPolyline', () => {
  const meridian: [number, number][] = [
    [0, 0],
    [0, 1],
  ];
  it('projects a point onto the segment with arclength', () => {
    const r = nearestOnPolyline(meridian, [0.001, 0.5]);
    expect(r.segmentIndex).toBe(0);
    expect(r.distM).toBeGreaterThan(100); // ~111 m east of the line
    expect(r.distM).toBeLessThan(122);
    expect(r.arclengthM).toBeGreaterThan(55_000);
    expect(r.arclengthM).toBeLessThan(56_000);
  });
  it('clamps to the line end', () => {
    const r = nearestOnPolyline(meridian, [0, 2]);
    expect(r.distM).toBeGreaterThan(110_000);
    expect(r.arclengthM).toBeCloseTo(111_195, -2); // one full degree of latitude
  });
});

describe('decodePolyline', () => {
  it('decodes the reference example at precision 5', () => {
    const coords = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(coords).toHaveLength(3);
    expect(coords[0][0]).toBeCloseTo(-120.2, 3);
    expect(coords[0][1]).toBeCloseTo(38.5, 3);
    expect(coords[2][0]).toBeCloseTo(-126.453, 3);
    expect(coords[2][1]).toBeCloseTo(43.252, 3);
  });
});

describe('formatters', () => {
  it('formatDistance', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(9_400)).toBe('9.4 km');
    expect(formatDistance(12_400)).toBe('12 km');
    expect(formatDistance(154_000)).toBe('154 km');
  });
  it('formatDuration', () => {
    expect(formatDuration(12 * 60)).toBe('12 min');
    expect(formatDuration(65 * 60)).toBe('1 h 05 min');
  });
  it('formatEta rolls over midnight', () => {
    const now = new Date(2026, 10, 1, 23, 50).getTime(); // 2026-11-01 23:50 local
    expect(formatEta(20 * 60, now)).toBe('00:10');
  });
});
