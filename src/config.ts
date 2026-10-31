/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lostless · service configuration
 * ─────────────────────────────────────────────────────────────────────────────
 *  Every external service the app talks to is configured HERE and only here.
 *  Want to self-host later? Change the URLs below — nothing else in the code
 *  knows about them.
 *
 *  Everything below is 100% free, no API keys:
 *   · tiles   → OpenFreeMap public instance (vector tiles, no key, attribution required)
 *   · search  → Nominatim on openstreetmap.org (usage policy: max 1 req/sec,
 *               identifiable app — we throttle client-side and search on Enter)
 *   · routing → public FOSSGIS Valhalla instance (supports car/walk/bike) or the
 *               OSRM demo server (driving only on the public demo). Pick one with
 *               `routing.engine`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type TravelMode = 'car' | 'walk' | 'bike';

export const CONFIG = {
  map: {
    /** OpenFreeMap styles — dark for dark mode, positron for light mode. */
    darkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
    lightStyleUrl: 'https://tiles.openfreemap.org/styles/positron',
    /** OSM raster tiles — only used by the no-WebGL2 Leaflet fallback map */
    osmRasterUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    /** Frankfurt am Main — change to your home town. [lon, lat] */
    initialCenter: [8.6821, 50.1109] as [number, number],
    initialZoom: 12.5,
    navigationZoom: 17.5,
    /** don't auto-follow the GPS dot closer than this */
    minFollowZoom: 15,
  },

  nominatim: {
    baseUrl: 'https://nominatim.openstreetmap.org',
    /** Nominatim usage policy: max 1 request/second. Enforced client-side. */
    minIntervalMs: 1100,
    searchLimit: 6,
    timeoutMs: 10000,
  },

  routing: {
    /** 'valhalla' = FOSSGIS public instance (car + walk + bike).
     *  'osrm'    = OSRM demo server (only 'driving' is loaded there publicly). */
    engine: 'valhalla' as 'valhalla' | 'osrm',

    valhalla: {
      baseUrl: 'https://valhalla1.openstreetmap.de',
      /** tried automatically if the primary host is unreachable */
      fallbackBaseUrl: 'https://valhalla2.openstreetmap.de',
      costing: { car: 'auto', walk: 'pedestrian', bike: 'bicycle' } as Record<TravelMode, string>,
    },

    osrm: {
      baseUrl: 'https://router.project-osrm.org',
      profiles: { car: 'driving', walk: 'foot', bike: 'bike' } as Record<TravelMode, string>,
    },

    timeoutMs: 15000,
    /** FOSSGIS rate limit is 1 call/user/sec — throttle client-side too */
    minIntervalMs: 1100,
  },

  /** re-route automatically when we drift this far from the route line */
  reroute: {
    thresholdM: 60,
    consecutiveFixes: 3,
  },

  storageKeys: {
    favorites: 'lostless:favorites:v1',
    theme: 'lostless:theme',
  },
} as const;

/* ─────────────────────────────────────────────────────────────────────────────
 * Preview proxy (Arena live preview)
 * ─────────────────────────────────────────────────────────────────────────────
 * The Arena live preview serves this app from a *.e2b.app host, where requests
 * to third-party origins (tile servers, geocoder, routers) can be blocked —
 * which shows up as a completely blank map. In that context every external
 * call is routed through same-origin /proxy/* paths that vite (dev AND
 * preview) forwards to the real services — see `serviceProxy` in vite.config.ts.
 * On GitHub Pages (production) and in tests we use the direct https URLs.
 * ─────────────────────────────────────────────────────────────────────────── */

export const PROXY_PREFIX = '/proxy';

/** production origin → same-origin proxy path (kept in sync with vite.config.ts) */
const HOST_TO_PROXY: ReadonlyArray<readonly [string, string]> = [
  ['https://tiles.openfreemap.org', `${PROXY_PREFIX}/ofm`],
  ['https://nominatim.openstreetmap.org', `${PROXY_PREFIX}/nominatim`],
  ['https://valhalla1.openstreetmap.de', `${PROXY_PREFIX}/valhalla1`],
  ['https://valhalla2.openstreetmap.de', `${PROXY_PREFIX}/valhalla2`],
  ['https://router.project-osrm.org', `${PROXY_PREFIX}/osrm`],
  ['https://tile.openstreetmap.org', `${PROXY_PREFIX}/osm`],
];

/** true when the app is served from the Arena live preview (*.e2b.app) */
export function previewProxied(hostname: string = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
  return /(^|\.)e2b\.app$/i.test(hostname);
}

/** Map a production service URL to the URL actually used at runtime. */
export function svcUrl(url: string, hostname?: string): string {
  if (!previewProxied(hostname)) return url;
  for (const [host, proxyPath] of HOST_TO_PROXY) {
    if (url.startsWith(host)) return proxyPath + url.slice(host.length);
  }
  return url;
}

/** Rewrite every known absolute URL inside a map style JSON (sources, sprite, glyphs, …). */
export function rewriteStyleUrls<T>(node: T, hostname?: string): T {
  if (typeof node === 'string') return svcUrl(node, hostname) as unknown as T;
  if (Array.isArray(node)) return node.map((v) => rewriteStyleUrls(v, hostname)) as unknown as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = rewriteStyleUrls(v, hostname);
    return out as T;
  }
  return node;
}
