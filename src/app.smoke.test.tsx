// @vitest-environment jsdom
/**
 * Functional smoke test: mounts the real App with a mocked map + mocked
 * network, then drives the whole flow — search → pick → route → START —
 * plus the tap-on-map flow. Catches render/runtime errors without a browser.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import { CONFIG } from './config';

// no artificial 1 req/s delays in tests
const find = (re: RegExp) => screen.findByText(re, {}, { timeout: 8000 });

// ── mock maplibre-gl (jsdom has no WebGL) ────────────────────────────────────
const glHandlers: Record<string, Array<(...a: unknown[]) => void>> = {};
const glSources: Record<string, { setData: (d: unknown) => void }> = {};
const glMap = {
  on: vi.fn((type: string, fn: (...a: unknown[]) => void) => {
    (glHandlers[type] ??= []).push(fn);
  }),
  addControl: vi.fn(),
  remove: vi.fn(),
  getCenter: () => ({ lng: 8.6821, lat: 50.1109 }),
  isStyleLoaded: () => true,
  getSource: vi.fn((id: string) => glSources[id]),
  addSource: vi.fn((id: string) => {
    glSources[id] = { setData: vi.fn() };
  }),
  addLayer: vi.fn(),
  getLayer: () => undefined,
  setPaintProperty: vi.fn(),
  getZoom: () => 12,
  zoomTo: vi.fn(),
  easeTo: vi.fn(),
  jumpTo: vi.fn(),
  setStyle: vi.fn(),
  getBearing: () => 0,
  resize: vi.fn(),
  getStyle: () => ({ layers: [] }),
  getLayoutProperty: () => undefined,
  setLayoutProperty: vi.fn(),
};
// plain function (not arrow) so `new Map()` works and returns the shared instance
function FakeMap(this: unknown) {
  return glMap;
}
vi.mock('maplibre-gl', () => ({
  default: {
    Map: FakeMap,
    Marker: function FakeMarker(this: unknown) {
      return { setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
    },
    AttributionControl: vi.fn(),
    supported: () => true,
    config: { WORKER_URL: '' },
  },
}));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

// ── polyline6 encoder (to build a fake valhalla shape) ───────────────────────
function encodeValue(v: number): string {
  let val = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (val >= 0x20) {
    s += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
    val >>= 5;
  }
  return s + String.fromCharCode(val + 63);
}
function encodePolyline(coords: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

const VALHALLA_TRIP = {
  trip: {
    summary: { length: 0.2, time: 30 },
    legs: [
      {
        shape: encodePolyline([
          [8.68, 50.11],
          [8.69, 50.12],
        ]),
        maneuvers: [
          { instruction: 'Head east on Teststraße.', street_names: ['Teststraße'], length: 0.2, time: 30, type: 0, begin_shape_index: 0 },
          { instruction: 'Your destination is on the right.', street_names: [], length: 0, time: 0, type: 1, begin_shape_index: 1 },
        ],
      },
    ],
  },
};

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;

// ── environment stubs ────────────────────────────────────────────────────────
beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (CONFIG.nominatim as { minIntervalMs: number }).minIntervalMs = 0;
  (CONFIG.routing as { minIntervalMs: number }).minIntervalMs = 0;
  // pin settings with perf OFF — CI machines have few cores and would auto-enable lite mode
  localStorage.setItem(
    CONFIG.storageKeys.settings,
    JSON.stringify({ voice: false, perf: false, faLabels: false, mapStyle: 'auto' }),
  );

  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);

  // pretend WebGL2 exists so the GL map path (mocked maplibre) is chosen
  const origGetContext = HTMLCanvasElement.prototype.getContext as unknown as (t: string) => unknown;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type === 'webgl2') return {};
    return origGetContext?.call(this, type) ?? null;
  } as typeof HTMLCanvasElement.prototype.getContext;
  Element.prototype.scrollIntoView = vi.fn();

  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (ok: (p: GeolocationPosition) => void) => {
        setTimeout(() => {
          ok({
            coords: { latitude: 50.11, longitude: 8.68, accuracy: 12, heading: null, altitude: null, altitudeAccuracy: null, speed: null },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 0);
        return 1;
      },
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('nominatim.openstreetmap.org/search')) {
        return ok([{ place_id: 42, display_name: 'Test Plaza, Frankfurt am Main, Germany', lat: '50.1136', lon: '8.6753', type: 'amenity' }]);
      }
      if (url.includes('nominatim.openstreetmap.org/reverse')) {
        return ok({ display_name: 'Tap Street 1, Frankfurt am Main, Germany' });
      }
      if (url.includes('/route?json=')) {
        return ok(VALHALLA_TRIP);
      }
      throw new Error('unexpected fetch: ' + url);
    }),
  );
});

afterEach(() => cleanup());

async function fireMapLoad() {
  await act(async () => {
    for (const f of glHandlers['load'] ?? []) f({});
  });
}

async function fireMapTap(lng: number, lat: number) {
  await act(async () => {
    for (const f of glHandlers['mousedown'] ?? []) f({ point: { x: 10, y: 10 } });
    for (const f of glHandlers['click'] ?? []) f({ point: { x: 11, y: 11 }, lngLat: { lng, lat } });
  });
}

describe('App smoke test', () => {
  it('renders the shell and loads the map', async () => {
    const App = (await import('./App')).default;
    render(<App />);
    expect(screen.getByText(/lostless/i)).toBeTruthy();
    expect(screen.getByLabelText('search a place')).toBeTruthy();
    expect(screen.getByText(/TAP THE MAP TO DROP A PIN/i)).toBeTruthy();
    await waitFor(() => expect(glMap.on).toHaveBeenCalled());
    await fireMapLoad();
    // GPS banner should not be sticky after a fix arrives
    await waitFor(() => expect(screen.getByText(/GPS ▸ LOCKED/)).toBeTruthy());
  });

  it('search → pick → route → START → STOP', async () => {
    const App = (await import('./App')).default;
    render(<App />);
    await fireMapLoad();

    const input = screen.getByLabelText('search a place');
    fireEvent.change(input, { target: { value: 'test plaza' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    const result = await find(/Test Plaza, Frankfurt/);
    fireEvent.click(result);

    // route panel with stats + START appears after the (mocked) valhalla call
    const start = await find(/▶ START/);
    expect(screen.getByText(/DIST \/\//)).toBeTruthy();
    fireEvent.click(start);
    expect(await find(/■ STOP NAVIGATION/)).toBeTruthy();
    // turn-by-turn list is in the sheet body
    expect(await find(/TURN-BY-TURN/)).toBeTruthy();
  });

  it('tap on map → reverse geocode → pin → route', async () => {
    const App = (await import('./App')).default;
    render(<App />);
    await fireMapLoad();
    await fireMapTap(8.7, 50.12);
    expect(await find(/Tap Street 1/)).toBeTruthy();
    expect(await find(/▶ START/)).toBeTruthy();
  });

  it('GPS denied shows a retry banner', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (_ok: unknown, err: (e: GeolocationPositionError) => void) => {
          setTimeout(() => err({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError), 0);
          return 2;
        },
        clearWatch: vi.fn(),
      },
    });
    const App = (await import('./App')).default;
    render(<App />);
    expect(await find(/GPS PERMISSION DENIED/)).toBeTruthy();
    expect(screen.getByText('RETRY')).toBeTruthy();
  });
});
