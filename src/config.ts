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
      costing: { car: 'auto', walk: 'pedestrian', bike: 'bicycle' } as Record<TravelMode, string>,
    },

    osrm: {
      baseUrl: 'https://router.project-osrm.org',
      profiles: { car: 'driving', walk: 'foot', bike: 'bike' } as Record<TravelMode, string>,
    },

    timeoutMs: 15000,
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
