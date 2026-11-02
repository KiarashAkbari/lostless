import type { RouteResult } from '../types';
import { haversineM } from './geo';

/**
 * Pure navigation math — extracted from the App component so it is unit-testable
 * without mounting React. All inputs are garbage-tolerant: NaN/Infinity in,
 * sane numbers out.
 */

export interface NavProgress {
  /** index into route.steps of the current step */
  stepIndex: number;
  /** distance from the current position to the end of the current step, meters */
  distToNextM: number;
  /** remaining route distance, meters */
  remainingM: number;
  /** remaining route time, seconds (proportional estimate) */
  remainingS: number;
}

/**
 * Map an arclength along the route polyline to progress through the steps.
 * `arclengthM` is the arclength of the nearest point on the route (see
 * nearestOnPolyline). Steps carry distances, so we walk the cumulative sum.
 */
export function computeNavProgress(route: RouteResult, arclengthM: number): NavProgress {
  const arc = Number.isFinite(arclengthM) && arclengthM > 0 ? arclengthM : 0;
  const steps = Array.isArray(route.steps) ? route.steps : [];
  let idx = 0;
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += Number.isFinite(steps[i]?.distanceM) ? (steps[i].distanceM as number) : 0;
    idx = i;
    if (acc >= arc) break;
  }
  const stepEnd = steps.slice(0, idx + 1).reduce((s, x) => s + (Number.isFinite(x?.distanceM) ? (x.distanceM as number) : 0), 0);
  const total = Number.isFinite(route.distanceM) && route.distanceM > 0 ? route.distanceM : 0;
  const remainingM = Math.max(0, total - arc);
  const durationS = Number.isFinite(route.durationS) && route.durationS > 0 ? route.durationS : 0;
  return {
    stepIndex: idx,
    distToNextM: Math.max(0, stepEnd - arc),
    remainingM,
    remainingS: total > 0 ? durationS * (remainingM / total) : 0,
  };
}

/**
 * Exponential smoothing for GPS fixes. Weak signal (accuracy > 60 m) → smooth
 * harder (small alpha, jitter is noise); strong signal + big jump → trust the
 * new fix (big alpha, it's a real move); tiny moves → smooth heavily.
 * Never returns non-finite coordinates.
 */
export function smoothPosition(
  prev: { lat: number; lon: number } | null,
  lat: number,
  lon: number,
  accuracy: number,
): { lat: number; lon: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lon) ? prev : { lat: 0, lon: 0 };
  }
  if (!prev || !Number.isFinite(prev.lat) || !Number.isFinite(prev.lon)) return { lat, lon };
  const moved = haversineM([prev.lon, prev.lat], [lon, lat]);
  const weak = !Number.isFinite(accuracy) || accuracy > 60;
  const alpha = weak ? 0.3 : moved > 25 ? 0.8 : moved > 3 ? 0.5 : 0.25;
  const out = { lat: prev.lat + (lat - prev.lat) * alpha, lon: prev.lon + (lon - prev.lon) * alpha };
  if (!Number.isFinite(out.lat) || !Number.isFinite(out.lon)) return { lat, lon };
  return out;
}
