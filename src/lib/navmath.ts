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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Kalman filter for GPS (what phone navigators actually run)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A two-state filter per axis: position and velocity, in metres and m/s in a
 *  local flat projection. Each fix is a *measurement* whose noise is the
 *  reported accuracy, so:
 *
 *   · standing still → the estimate settles and the dot stops twitching,
 *     even if the raw fixes hop 15 m around
 *   · driving → the velocity term carries the estimate through a bad fix or a
 *     short tunnel gap, instead of snapping back to the last noisy point
 *   · accuracy is not a constant: a 5 m fix pulls hard, a 60 m fix barely nudges
 *
 *  This replaces exponential smoothing, which cannot tell "noise" from "movement"
 *  and lags behind the car by design.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface KalmanState {
  /** position, local metres from the anchor point */
  x: number;
  y: number;
  /** velocity, m/s */
  vx: number;
  vy: number;
  /** anchor [lon, lat] the local metres are relative to */
  anchor: [number, number];
  /** 2x2 covariance per axis, stored as [P00, P01, P11] (symmetric) */
  covX: [number, number, number];
  covY: [number, number, number];
  /** timestamp of the last update, ms */
  t: number;
}

const M_PER_DEG_LAT = 110540;

/** local metres-per-degree-longitude at a latitude */
const lonScale = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

export interface KalmanOptions {
  /** spectral density of the acceleration noise, m²/s³ */
  q?: number;
  /** velocity damping per second (a stopped car's velocity should decay) */
  damping?: number;
  /**
   * Doppler speed from the platform, m/s. Far more accurate than differencing
   * positions, so when it says "stopped" the filter truly freezes.
   */
  speed?: number | null;
}

const DEFAULT_Q = 0.6;
/** process noise while the device is known to be standing still */
const STILL_Q = 0.02;
/** below this the device counts as stationary, m/s */
const STILL_SPEED = 0.6;
const MAX_SPEED = 90; // m/s — a bad fix must not launch the estimate

/** start a filter at the first fix */
export function kalmanInit(lon: number, lat: number, accuracy: number, now = Date.now()): KalmanState {
  const acc = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 30;
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    anchor: [lon, lat],
    covX: [acc * acc, 0, 0],
    covY: [acc * acc, 0, 0],
    t: now,
  };
}

/** one axis of a constant-velocity Kalman filter (position + velocity) */
function axisStep(
  pos: number,
  vel: number,
  cov: [number, number, number],
  meas: number,
  accuracy: number,
  dt: number,
  q: number,
  damping: number,
): { pos: number; vel: number; cov: [number, number, number] } {
  // predict: p' = pos + vel*dt ; P' = F P Fᵀ + Q
  const [p00, p01, p11] = cov;
  const predPos = pos + vel * dt;
  const predVel = vel * damping;

  const n00 = p00 + 2 * dt * p01 + dt * dt * p11 + (q * dt * dt * dt) / 3;
  const n01 = p01 + dt * p11 + (q * dt * dt) / 2;
  const n11 = p11 + q * dt;

  // update with H = [1, 0]: scalar innovation, gain is the first column of P
  const r = accuracy * accuracy;
  const sInnov = n00 + r;
  if (!(sInnov > 0)) return { pos: predPos, vel: predVel, cov: [n00, n01, n11] };
  const k0 = n00 / sInnov;
  const k1 = n01 / sInnov;
  const innovation = meas - predPos;

  const outPos = predPos + k0 * innovation;
  const outVel = predVel + k1 * innovation;
  // P' = (I - K H) P
  const u00 = n00 - k0 * n00;
  const u01 = n01 - k0 * n01;
  const u11 = n11 - k1 * n01;
  return {
    pos: Number.isFinite(outPos) ? outPos : predPos,
    vel: Number.isFinite(outVel) ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, outVel)) : 0,
    cov: [Math.max(0, u00), u01, Math.max(0, u11)],
  };
}

/**
 * Predict forward to `now`, then fold in one fix. Returns the new state and the
 * filtered [lon, lat]. Tolerates NaN fixes, zero accuracy and long gaps.
 */
export function kalmanUpdate(
  state: KalmanState | null,
  lon: number,
  lat: number,
  accuracy: number,
  now = Date.now(),
  opts: KalmanOptions = {},
): { state: KalmanState; lon: number; lat: number } {
  const acc = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 30;
  if (!state) {
    const init = kalmanInit(Number.isFinite(lon) ? lon : 0, Number.isFinite(lat) ? lat : 0, acc, now);
    return { state: init, lon: Number.isFinite(lon) ? lon : 0, lat: Number.isFinite(lat) ? lat : 0 };
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    const [flon, flat] = fromState(state);
    return { state, lon: flon, lat: flat };
  }

  const speedHint =
    opts.speed !== undefined && opts.speed !== null && Number.isFinite(opts.speed)
      ? Math.max(0, Math.min(MAX_SPEED, opts.speed))
      : null;
  const still = speedHint !== null && speedHint < STILL_SPEED;
  const q = opts.q ?? (still ? STILL_Q : DEFAULT_Q);
  const dampingPerSec = opts.damping ?? (still ? 0.5 : 0.9);
  const dt = Math.min(10, Math.max(0.2, (now - state.t) / 1000));
  const damping = Math.pow(dampingPerSec, dt);

  const kx = lonScale(state.anchor[1]);
  const measX = (lon - state.anchor[0]) * kx;
  const measY = (lat - state.anchor[1]) * M_PER_DEG_LAT;

  const ax = axisStep(state.x, state.vx, state.covX, measX, acc, dt, q, damping);
  const ay = axisStep(state.y, state.vy, state.covY, measY, acc, dt, q, damping);

  let vx = ax.vel;
  let vy = ay.vel;
  let covX = ax.cov;
  let covY = ay.cov;

  // Doppler speed is a second, independent measurement of the velocity vector.
  // Stationary: pin the velocity so the dot stops drifting with the jitter.
  // Moving: scale the vector to the reported magnitude and shrink its variance.
  if (speedHint !== null) {
    if (still) {
      vx = 0;
      vy = 0;
      covX = [covX[0], 0, 0.04];
      covY = [covY[0], 0, 0.04];
    } else if (Math.hypot(vx, vy) > 0.5) {
      const scale = speedHint / Math.hypot(vx, vy);
      vx *= scale;
      vy *= scale;
      const vVar = Math.pow(0.15 * speedHint + 0.4, 2);
      covX = [covX[0], covX[1], Math.min(covX[2], vVar)];
      covY = [covY[0], covY[1], Math.min(covY[2], vVar)];
    }
  }

  const next: KalmanState = {
    x: ax.pos,
    y: ay.pos,
    vx,
    vy,
    anchor: state.anchor,
    covX,
    covY,
    t: now,
  };
  const [fLon, fLat] = fromState(next);
  if (!Number.isFinite(fLon) || !Number.isFinite(fLat)) return { state: next, lon, lat };
  return { state: next, lon: fLon, lat: fLat };
}

/** local metres back to [lon, lat] */
export function fromState(s: KalmanState): [number, number] {
  return [s.anchor[0] + s.x / lonScale(s.anchor[1]), s.anchor[1] + s.y / M_PER_DEG_LAT];
}

/** filtered speed in m/s (useful when the platform reports `speed: null`) */
export function kalmanSpeed(s: KalmanState): number {
  return Math.hypot(s.vx, s.vy);
}
