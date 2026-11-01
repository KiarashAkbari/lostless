import { CONFIG, svcUrl } from '../config';
import type { Place } from '../types';

/**
 * Nominatim (OpenStreetMap search). Usage policy: max 1 request/second and an
 * identifiable client — browsers send Origin/Referer automatically, and we
 * hard-throttle to 1 req/s here. Searches fire on Enter only, never per keystroke.
 */

let lastRequestAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const wait = Math.max(0, CONFIG.nominatim.minIntervalMs - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.nominatim.timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    `${svcUrl(CONFIG.nominatim.baseUrl)}/search?format=jsonv2` +
    `&limit=${CONFIG.nominatim.searchLimit}&q=${encodeURIComponent(q)}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
  const data = (await res.json()) as Array<{
    place_id: number | string;
    display_name: string;
    lat: string;
    lon: string;
    type?: string;
    class?: string;
  }>;
  if (!Array.isArray(data)) return [];
  return data
    .map((d) => ({
      id: String(d.place_id),
      name: d.display_name ?? '',
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      kind: d.type ?? d.class,
    }))
    // drop results with garbage coordinates — they would crash the map marker
    .filter((d) => d.name && Number.isFinite(d.lat) && Number.isFinite(d.lon));
}

/** human-readable name for a tapped map point; falls back to raw coordinates */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url =
      `${svcUrl(CONFIG.nominatim.baseUrl)}/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lon}&zoom=17`;
    const res = await throttledFetch(url);
    if (!res.ok) throw new Error(`reverse failed (HTTP ${res.status})`);
    const d = (await res.json()) as { display_name?: string };
    if (d.display_name) return d.display_name;
  } catch {
    // fall through to coordinates
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
