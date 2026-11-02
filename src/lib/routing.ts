import { CONFIG, svcUrl, type TravelMode } from '../config';
import type { Lane, RouteAvoid, RouteResult, RouteStep } from '../types';
import { decodePolyline } from './geo';
import { maneuverLabel } from './maneuvers';
import { createThrottler } from './throttle';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Routing client. The engine + URLs live in src/config.ts only.
 *
 *  · valhalla (default): FOSSGIS public instance — supports car / walk / bike.
 *    Falls back to `fallbackBaseUrl` if the primary host is unreachable.
 *  · osrm:               OSRM demo server — public demo only loads "driving",
 *                        point `config.routing.osrm.baseUrl` at your own server
 *                        for foot/bike.
 */

// FOSSGIS allows 1 call/user/sec — throttle all routing requests client-side
// (shared throttler; interval read lazily so CONFIG/tests can change it)
const throttled = createThrottler(() => CONFIG.routing.minIntervalMs);

/** HTTP error with a status, so callers can tell 4xx (don't retry) from 5xx (retry elsewhere) */
class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.routing.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
    if (!res.ok) throw new HttpError(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

interface ValhallaSign {
  exit_number_elements?: Array<{ text?: string }>;
  exit_numbers?: Array<{ text?: string }> | string;
  elements?: Array<{ text?: string }>;
}

interface ValhallaManeuver {
  instruction: string;
  street_names?: string[];
  /** km when units=kilometers (some versions also expose `distance`) */
  length?: number;
  distance?: number;
  time: number; // seconds
  type: number;
  modifier?: string;
  begin_shape_index: number;
  /** the three-stage phrasing Valhalla writes for every maneuver */
  verbal_transition_alert_instruction?: string;
  verbal_pre_transition_instruction?: string;
  verbal_post_transition_instruction?: string;
  /** "and then turn left right after" — two maneuvers in one breath */
  verbal_multi_cue?: boolean;
  toll?: boolean;
  highway?: boolean;
  /** posted limit in km/h, 0/absent when unknown */
  speed_limit?: number;
  sign?: ValhallaSign;
  lanes?: Array<{ directions?: string[]; active?: boolean }>;
}

/** pull the motorway exit number out of whichever Valhalla shape it arrived in */
function exitNumber(m: ValhallaManeuver): string | undefined {
  const sign = m.sign;
  if (!sign) return undefined;
  const fromList = (list?: Array<{ text?: string }>) =>
    (list ?? [])
      .map((e) => (e?.text ?? '').trim())
      .filter(Boolean)
      .join(' ');
  if (Array.isArray(sign.exit_number_elements)) {
    const v = fromList(sign.exit_number_elements);
    if (v) return v;
  }
  if (Array.isArray(sign.exit_numbers)) {
    const v = fromList(sign.exit_numbers);
    if (v) return v;
  }
  if (typeof sign.exit_numbers === 'string' && sign.exit_numbers.trim()) return sign.exit_numbers.trim();
  return undefined;
}

/** lane hints, dropping the empty ones Valhalla sometimes emits */
function parseLanes(lanes?: ValhallaManeuver['lanes']): Lane[] | undefined {
  if (!lanes?.length) return undefined;
  const out: Lane[] = [];
  for (const l of lanes) {
    const directions = (l?.directions ?? []).map((d) => String(d).trim()).filter(Boolean);
    if (!directions.length) continue;
    out.push({ directions, active: Boolean(l?.active) });
  }
  return out.length ? out : undefined;
}

/**
 * Costing options for the "avoid" switches. Only the keys each costing
 * understands are sent (Valhalla rejects unknown ones on some versions); tour
 * roads are the ones that can actually use tolls or motorways.
 */
function costingOptions(costing: string, avoid?: RouteAvoid): Record<string, unknown> | undefined {
  if (!avoid || (!avoid.tolls && !avoid.highways && !avoid.ferries)) return undefined;
  const opts: Record<string, unknown> = {};
  if (costing === 'auto') {
    if (avoid.tolls) opts.use_tolls = 0;
    if (avoid.highways) opts.use_highways = 0;
  }
  if (avoid.ferries) opts.use_ferry = 0;
  return Object.keys(opts).length ? opts : undefined;
}

interface ValhallaResponse {
  trip?: {
    summary?: { length: number; time: number };
    legs?: Array<{ shape: string; maneuvers?: ValhallaManeuver[] }>;
  };
  error?: string;
}

// Valhalla maneuver type ids → OSRM-ish names, so both engines share one UI vocabulary
const VALHALLA_TYPES: Record<number, string> = {
  0: 'depart', 1: 'arrive', 2: 'turn', 3: 'continue', 4: 'merge', 5: 'fork',
  6: 'roundabout', 7: 'rotary', 8: 'exit roundabout', 9: 'ferry', 10: 'new name',
  11: 'notification', 12: 'use lane', 13: 'off ramp', 14: 'on ramp',
};
const valhallaTypeName = (t: number) => VALHALLA_TYPES[t] ?? 'continue';

function parseValhalla(data: ValhallaResponse): RouteResult {
  if (!data.trip || !data.trip.legs?.length) {
    throw new Error(data.error ? `valhalla: ${data.error}` : 'valhalla: no route found');
  }
  const legs = data.trip.legs;
  // multi-leg trip (waypoints): each leg's shape starts where the previous one
  // ended, so the join point is dropped and shape indices are re-based
  const coords: [number, number][] = [];
  const positions: Array<{ m: ValhallaManeuver; index: number; legIndex: number }> = [];
  legs.forEach((leg, legIndex) => {
    const shape = decodePolyline(leg.shape); // [lon, lat]
    if (!shape.length) return;
    if (coords.length) coords.pop(); // duplicate join vertex
    const offset = coords.length;
    for (const c of shape) coords.push(c);
    for (const m of leg.maneuvers ?? []) {
      positions.push({ m, index: Math.min(offset + Math.max(0, m.begin_shape_index ?? 0), coords.length - 1), legIndex });
    }
  });
  if (coords.length < 2) throw new Error('valhalla: route shape is empty/invalid');
  const stepFrom = (m: ValhallaManeuver, locIndex: number, legIndex: number): RouteStep => {
    const lanes = parseLanes(m.lanes);
    const exit = exitNumber(m);
    const limit = Number.isFinite(m.speed_limit) && (m.speed_limit as number) > 0 ? (m.speed_limit as number) : undefined;
    const step: RouteStep = {
      instruction: stripTags(m.instruction ?? ''),
      street: (m.street_names ?? []).join(', '),
      distanceM: Math.max(0, ((m.length ?? m.distance ?? 0) as number) * 1000) || 0,
      durationS: Number.isFinite(m.time) ? m.time : 0,
      type: valhallaTypeName(m.type),
      modifier: m.modifier,
      location: coords[locIndex],
    };
    const verbal = stripTags(m.verbal_pre_transition_instruction ?? '');
    const verbalAlert = stripTags(m.verbal_transition_alert_instruction ?? '');
    const verbalPost = stripTags(m.verbal_post_transition_instruction ?? '');
    if (verbal) step.verbal = verbal;
    if (verbalAlert) step.verbalAlert = verbalAlert;
    if (verbalPost) step.verbalPost = verbalPost;
    if (m.verbal_multi_cue) step.multiCue = true;
    if (lanes) step.lanes = lanes;
    if (exit) step.exitNumber = exit;
    if (m.toll) step.toll = true;
    if (m.highway) step.highway = true;
    if (limit) step.speedLimit = limit;
    // the "arrive" maneuver at the end of a non-final leg is a waypoint, not
    // the destination — saying "you have arrived" there would be a lie
    if (legIndex < legs.length - 1 && step.type === 'arrive') {
      step.instruction = `Stop ${legIndex + 1}`;
      step.verbal = `You have reached stop ${legIndex + 1}.`;
      step.verbalPost = undefined;
      step.verbalAlert = undefined;
    }
    return step;
  };
  const steps: RouteStep[] = positions.map(({ m, index, legIndex }) => stepFrom(m, index, legIndex));
  const sumLen = data.trip.summary?.length;
  const sumTime = data.trip.summary?.time;
  const result: RouteResult = {
    coords,
    steps,
    distanceM: Number.isFinite(sumLen) ? (sumLen as number) * 1000 : 0,
    durationS: Number.isFinite(sumTime) ? (sumTime as number) : 0,
  };
  // trip-level flags let the UI warn "this route has tolls" before driving off
  if (steps.some((s) => s.toll)) result.hasToll = true;
  if (steps.some((s) => s.highway)) result.hasHighway = true;
  if (steps.some((s) => s.type === 'ferry')) result.hasFerry = true;
  return result;
}

async function routeValhallaOnce(
  baseUrl: string,
  mode: TravelMode,
  from: [number, number],
  to: [number, number],
  avoid?: RouteAvoid,
  via: [number, number][] = [],
): Promise<RouteResult> {
  const costing = CONFIG.routing.valhalla.costing[mode];
  const options = costingOptions(costing, avoid);
  const payload: Record<string, unknown> = {
    // stops are "break" locations: you actually stop there, which is what a
    // driver adding a waypoint expects
    locations: [
      { lat: from[1], lon: from[0] },
      ...via.map((v) => ({ lat: v[1], lon: v[0], type: 'break' as const })),
      { lat: to[1], lon: to[0] },
    ],
    costing,
    units: 'kilometers',
    directions_options: { units: 'kilometers' },
    // shape_format defaults to polyline6
  };
  if (options) payload.costing_options = { [costing]: options };
  const url = `${svcUrl(baseUrl)}/route?json=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    return parseValhalla((await fetchJson(url)) as ValhallaResponse);
  } catch (err) {
    // an older instance may not know a costing option: a route with the
    // avoided road type still beats no route at all
    if (options && err instanceof HttpError && err.status === 400) {
      delete payload.costing_options;
      const plain = `${svcUrl(baseUrl)}/route?json=${encodeURIComponent(JSON.stringify(payload))}`;
      return parseValhalla((await fetchJson(plain)) as ValhallaResponse);
    }
    throw err;
  }
}

async function routeValhalla(
  mode: TravelMode,
  from: [number, number],
  to: [number, number],
  avoid?: RouteAvoid,
  via: [number, number][] = [],
): Promise<RouteResult> {
  try {
    return await routeValhallaOnce(CONFIG.routing.valhalla.baseUrl, mode, from, to, avoid, via);
  } catch (err) {
    // Only retry the fallback host on network-level failures or 5xx — never on
    // 4xx ("no route" / bad request would just fail again on the other host).
    if (err instanceof HttpError && err.status < 500) throw err;
    if (err instanceof Error && err.message.startsWith('valhalla:')) throw err;
    if (CONFIG.routing.valhalla.fallbackBaseUrl) {
      return routeValhallaOnce(CONFIG.routing.valhalla.fallbackBaseUrl, mode, from, to, avoid, via);
    }
    throw err;
  }
}

interface OsrmStep {
  name: string;
  distance: number; // m
  duration: number; // s
  maneuver: { type: string; modifier?: string; location: [number, number] };
}

async function routeOsrm(mode: TravelMode, from: [number, number], to: [number, number]): Promise<RouteResult> {
  const profile = CONFIG.routing.osrm.profiles[mode];
  const url =
    `${svcUrl(CONFIG.routing.osrm.baseUrl)}/route/v1/${profile}/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?steps=true&geometries=geojson&overview=full`;
  const data = (await fetchJson(url)) as {
    code: string;
    message?: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
      legs: Array<{ steps: OsrmStep[] }>;
    }>;
  };
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(data.message ? `osrm: ${data.message}` : 'osrm: no route found');
  }
  const r = data.routes[0];
  if (!r.geometry?.coordinates || r.geometry.coordinates.length < 2) throw new Error('osrm: route geometry is empty/invalid');
  const steps: RouteStep[] = (r.legs ?? []).flatMap((l) =>
    l.steps.map((s) => {
      const label = cap(maneuverLabel({ type: s.maneuver.type, modifier: s.maneuver.modifier }));
      return {
        instruction: s.name && s.maneuver.type !== 'arrive' ? `${label} onto ${s.name}` : label,
        street: s.name,
        distanceM: Number.isFinite(s.distance) ? s.distance : 0,
        durationS: Number.isFinite(s.duration) ? s.duration : 0,
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        location: s.maneuver.location,
      };
    }),
  );
  return {
    coords: r.geometry.coordinates,
    steps,
    distanceM: Number.isFinite(r.distance) ? r.distance : 0,
    durationS: Number.isFinite(r.duration) ? r.duration : 0,
  };
}

export function getRoute(
  mode: TravelMode,
  from: [number, number],
  to: [number, number],
  avoid?: RouteAvoid,
  /** intermediate stops, in order */
  via: [number, number][] = [],
): Promise<RouteResult> {
  return throttled(() => {
    if (CONFIG.routing.engine === 'valhalla') return routeValhalla(mode, from, to, avoid, via);
    // the OSRM demo profile only routes two points — say so rather than quietly
    // dropping a stop the driver asked for
    if (via.length) return Promise.reject(new Error('osrm: stops need the Valhalla engine'));
    return routeOsrm(mode, from, to);
  });
}
