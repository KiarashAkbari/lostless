import { describe, it, expect } from 'vitest';
import { computeNavProgress, smoothPosition } from './navmath';
import type { RouteResult } from '../types';

const route: RouteResult = {
  coords: [[8.68, 50.11], [8.69, 50.12]],
  distanceM: 1500,
  durationS: 300,
  steps: [
    { instruction: 'a', street: 'A', distanceM: 500, durationS: 100, type: 'depart', location: [8.68, 50.11] },
    { instruction: 'b', street: 'B', distanceM: 700, durationS: 140, type: 'turn', modifier: 'left', location: [8.685, 50.115] },
    { instruction: 'c', street: '', distanceM: 300, durationS: 60, type: 'arrive', location: [8.69, 50.12] },
  ],
};

describe('computeNavProgress', () => {
  it('start of route → first step, full distance remaining', () => {
    const n = computeNavProgress(route, 0);
    expect(n.stepIndex).toBe(0);
    expect(n.distToNextM).toBe(500);
    expect(n.remainingM).toBe(1500);
    expect(n.remainingS).toBe(300);
  });
  it('mid second step → stepIndex 1, distance to step end', () => {
    const n = computeNavProgress(route, 600);
    expect(n.stepIndex).toBe(1);
    expect(n.distToNextM).toBe(600); // 500+700 - 600
    expect(n.remainingM).toBe(900);
    expect(n.remainingS).toBeCloseTo(180);
  });
  it('past the end → clamps to last step, zero remaining', () => {
    const n = computeNavProgress(route, 99999);
    expect(n.stepIndex).toBe(2);
    expect(n.distToNextM).toBe(0);
    expect(n.remainingM).toBe(0);
    expect(n.remainingS).toBe(0);
  });
  it('garbage arclength / empty steps / zero distance never produce NaN', () => {
    for (const bad of [NaN, Infinity, -5]) {
      const n = computeNavProgress(route, bad);
      expect(Number.isFinite(n.stepIndex)).toBe(true);
      expect(Number.isFinite(n.distToNextM)).toBe(true);
      expect(Number.isFinite(n.remainingM)).toBe(true);
      expect(Number.isFinite(n.remainingS)).toBe(true);
    }
    const empty: RouteResult = { coords: [], steps: [], distanceM: NaN, durationS: NaN };
    const n = computeNavProgress(empty, 10);
    expect(n.stepIndex).toBe(0);
    expect(n.remainingM).toBe(0);
    expect(n.remainingS).toBe(0);
  });
});

describe('smoothPosition', () => {
  it('first fix passes through untouched', () => {
    expect(smoothPosition(null, 50.11, 8.68, 10)).toEqual({ lat: 50.11, lon: 8.68 });
  });
  it('weak signal (accuracy > 60 m) smooths harder than a strong big jump', () => {
    const prev = { lat: 50.11, lon: 8.68 };
    const next = { lat: 50.1101, lon: 8.6801 }; // ~14 m move
    const weak = smoothPosition(prev, next.lat, next.lon, 100);
    const strong = smoothPosition(prev, next.lat, next.lon, 10);
    const movedWeak = Math.abs(weak.lat - prev.lat);
    const movedStrong = Math.abs(strong.lat - prev.lat);
    expect(movedWeak).toBeLessThan(movedStrong); // weak → smaller step toward new fix
  });
  it('NaN fix keeps the previous position instead of poisoning it', () => {
    const prev = { lat: 50.11, lon: 8.68 };
    expect(smoothPosition(prev, NaN, 8.68, 10)).toEqual(prev);
    expect(smoothPosition(null, NaN, NaN, 10)).toEqual({ lat: 0, lon: 0 });
  });
});
