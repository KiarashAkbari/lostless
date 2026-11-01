import { CONFIG, svcUrl, type TravelMode } from '../config';
import type { RouteResult, RouteStep } from '../types';
import { decodePolyline } from './geo';
import { maneuverLabel } from './maneuvers';

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
let lastRouteAt = 0;
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, CONFIG.routing.minIntervalMs - (Date.now() - lastRouteAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRouteAt = Date.now();
  return fn();
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.routing.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

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
  const leg = data.trip.legs[0];
  const coords = decodePolyline(leg.shape); // [lon, lat]
  if (coords.length < 2) throw new Error('valhalla: route shape is empty/invalid');
  const steps: RouteStep[] = (leg.maneuvers ?? []).map((m) => ({
    instruction: stripTags(m.instruction ?? ''),
    street: (m.street_names ?? []).join(', '),
    distanceM: Math.max(0, ((m.length ?? m.distance ?? 0) as number) * 1000) || 0,
    durationS: Number.isFinite(m.time) ? m.time : 0,
    type: valhallaTypeName(m.type),
    modifier: m.modifier,
    location: coords[Math.min(Math.max(0, m.begin_shape_index ?? 0), coords.length - 1)],
  }));
  const sumLen = data.trip.summary?.length;
  const sumTime = data.trip.summary?.time;
  return {
    coords,
    steps,
    distanceM: Number.isFinite(sumLen) ? (sumLen as number) * 1000 : 0,
    durationS: Number.isFinite(sumTime) ? (sumTime as number) : 0,
  };
}

async function routeValhallaOnce(baseUrl: string, mode: TravelMode, from: [number, number], to: [number, number]): Promise<RouteResult> {
  const costing = CONFIG.routing.valhalla.costing[mode];
  const payload = {
    locations: [
      { lat: from[1], lon: from[0] },
      { lat: to[1], lon: to[0] },
    ],
    costing,
    units: 'kilometers',
    directions_options: { units: 'kilometers' },
    // shape_format defaults to polyline6
  };
  const url = `${svcUrl(baseUrl)}/route?json=${encodeURIComponent(JSON.stringify(payload))}`;
  return parseValhalla((await fetchJson(url)) as ValhallaResponse);
}

async function routeValhalla(mode: TravelMode, from: [number, number], to: [number, number]): Promise<RouteResult> {
  try {
    return await routeValhallaOnce(CONFIG.routing.valhalla.baseUrl, mode, from, to);
  } catch (err) {
    // only retry the fallback host on network-level failures, not "no route"
    if (err instanceof Error && err.message.startsWith('HTTP 4')) throw err;
    if (CONFIG.routing.valhalla.fallbackBaseUrl) {
      return routeValhallaOnce(CONFIG.routing.valhalla.fallbackBaseUrl, mode, from, to);
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

export function getRoute(mode: TravelMode, from: [number, number], to: [number, number]): Promise<RouteResult> {
  return throttled(() =>
    CONFIG.routing.engine === 'valhalla' ? routeValhalla(mode, from, to) : routeOsrm(mode, from, to),
  );
}
