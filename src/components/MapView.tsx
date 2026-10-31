import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, LineString } from 'geojson';
import { CONFIG, previewProxied, svcUrl, rewriteStyleUrls, styleUrlFor, type MapStyle } from '../config';
import type { Place, RouteResult } from '../types';
import type { Theme } from '../hooks/useTheme';
import { circlePolygon } from '../lib/geo';

// Load the MapLibre worker from a same-origin file instead of the default
// inline blob worker, so the map also works where a CSP blocks blob: workers
// (e.g. the Arena live preview). The file is copied to public/ at build time
// (scripts/copy-maplibre-worker.mjs).
if (typeof document !== 'undefined') {
  maplibregl.config.WORKER_URL = new URL('maplibre-gl-csp-worker.js', document.baseURI).href;
}

export interface MapApi {
  getCenter: () => [number, number];
  zoomBy: (delta: number) => void;
  centerOn: (ll: [number, number], zoom?: number) => void;
}

export type MapStatus = 'loading' | 'ready' | 'error';
export type MapRenderer = 'gl' | 'raster';

export interface MapViewProps {
  theme: Theme;
  /** pinned map style ('auto' follows the theme) */
  mapStyle?: MapStyle;
  pos: GeolocationPosition | null;
  /** position to draw the dot at (snapped to the route while navigating) */
  displayPos?: GeolocationPosition | null;
  destination: Place | null;
  route: RouteResult | null;
  /** while navigating: polyline from the current position to the destination */
  remainingCoords: [number, number][] | null;
  navigating: boolean;
  follow: boolean;
  /** force the Leaflet raster fallback even when WebGL2 is available */
  forceRaster?: boolean;
  /** lite mode: no animations, lower zoom cap, no world copies (older phones) */
  perf?: boolean;
  /** prefer Persian (name:fa) labels on symbol layers */
  faLabels?: boolean;
  onMapTap: (lngLat: [number, number]) => void;
  /** lets the parent read the map center (fallback origin) and drive zoom/center */
  onMapReady?: (api: MapApi) => void;
  /** map lifecycle reporting so the UI can show loading / error states */
  onStatus?: (s: MapStatus, msg?: string, renderer?: MapRenderer) => void;
}

const RasterMapView = lazy(() => import('./RasterMapView').then((m) => ({ default: m.RasterMapView })));

function MapLoading() {
  return (
    <div className="map-container map-loading">
      <span className="mono">LOADING MAP<span className="dots">…</span></span>
    </div>
  );
}

/**
 * Picks the renderer: MapLibre (WebGL2) when available, otherwise a lightweight
 * Leaflet raster fallback so the app still works on old WebViews.
 */
function webgl2Supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function MapView(props: MapViewProps) {
  // MapLibre v5 needs WebGL2; without it (or when forced) we render the raster fallback instead
  const supported = useMemo(() => webgl2Supported(), []);
  if (!supported || props.forceRaster) {
    return (
      <Suspense fallback={<MapLoading />}>
        <RasterMapView {...props} />
      </Suspense>
    );
  }
  return <GlMapView {...props} />;
}

const styleFor = (theme: Theme, mapStyle: MapStyle = 'auto') => styleUrlFor(theme, mapStyle);

/**
 * Resolve the style for a theme. Production: pass the URL through (cached by
 * the service worker). Arena preview (*.e2b.app): fetch the style JSON through
 * the same-origin proxy and rewrite every absolute URL inside it (sources,
 * sprite, glyphs) to the proxy too, so nothing cross-origin is requested.
 */
async function resolveStyle(theme: Theme, mapStyle: MapStyle = 'auto'): Promise<string | maplibregl.StyleSpecification> {
  const url = styleFor(theme, mapStyle);
  if (!previewProxied()) return url;
  const res = await fetch(svcUrl(url), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`style HTTP ${res.status}`);
  return rewriteStyleUrls((await res.json()) as maplibregl.StyleSpecification);
}

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>' +
  ' · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>';

function GlMapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const styleLoadedRef = useRef(false);
  const lastFollowRef = useRef<[number, number] | null>(null);
  const errorCountRef = useRef(0);
  const origTextFieldRef = useRef(new Map<string, unknown>());
  const applyLabelsRef = useRef<() => void>(() => {});

  // latest data for callbacks / style reloads (avoid stale closures)
  const dataRef = useRef({ theme: props.theme, mapStyle: props.mapStyle ?? 'auto', pos: props.pos, displayPos: props.displayPos ?? null, destination: props.destination, route: props.route, remaining: props.remainingCoords, navigating: props.navigating });
  dataRef.current = { theme: props.theme, mapStyle: props.mapStyle ?? 'auto', pos: props.pos, displayPos: props.displayPos ?? null, destination: props.destination, route: props.route, remaining: props.remainingCoords, navigating: props.navigating };
  const perfRef = useRef(props.perf ?? false);
  perfRef.current = props.perf ?? false;
  const faLabelsRef = useRef(props.faLabels ?? false);
  faLabelsRef.current = props.faLabels ?? false;
  const instantRef = useRef(false);
  instantRef.current =
    (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || (props.perf ?? false);
  const onTapRef = useRef(props.onMapTap);
  onTapRef.current = props.onMapTap;
  const onStatusRef = useRef(props.onStatus);
  onStatusRef.current = props.onStatus;

  const syncDynamic = () => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current || !map.isStyleLoaded()) return;
    const { route, remaining, navigating } = dataRef.current;
    const accent = getCssVar('--accent');
    const routeColor = getCssVar('--route-muted');

    if (!map.getSource('route-full')) {
      map.addSource('route-full', { type: 'geojson', data: emptyLine });
      map.addSource('route-rest', { type: 'geojson', data: emptyLine });
      map.addLayer({
        id: 'route-full-line', type: 'line', source: 'route-full',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': navigating ? routeColor : accent, 'line-width': 6, 'line-opacity': navigating ? 0.45 : 1 },
      });
      map.addLayer({
        id: 'route-rest-line', type: 'line', source: 'route-rest',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': accent, 'line-width': 6 },
      });
    }
    const full = route?.coords?.length ? lineFeature(route.coords) : emptyLine;
    const rest = navigating && remaining?.length ? lineFeature(remaining) : emptyLine;
    const srcFull = map.getSource('route-full') as maplibregl.GeoJSONSource | undefined;
    const srcRest = map.getSource('route-rest') as maplibregl.GeoJSONSource | undefined;
    if (!srcFull || !srcRest) return; // style not ready yet — style.load will re-sync
    srcFull.setData(full);
    srcRest.setData(rest);
    if (map.getLayer('route-full-line')) {
      map.setPaintProperty('route-full-line', 'line-color', navigating ? routeColor : accent);
    }
  };

  // init map once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    onStatusRef.current?.('loading', undefined, 'gl');
    // if the style never loads, the map area stays blank — surface it
    const styleTimer = window.setTimeout(() => {
      if (!styleLoadedRef.current) onStatusRef.current?.('error', 'map style did not load within 15s');
    }, 15000);
    // blank-map watchdog: style loaded but zero tiles rendered after 8s
    let tileWatchdog = 0;
    const contentTiles = { n: 0 };

    void (async () => {
      let style: string | maplibregl.StyleSpecification;
      try {
        style = await resolveStyle(dataRef.current.theme, dataRef.current.mapStyle);
      } catch (err) {
        if (!cancelled) onStatusRef.current?.('error', err instanceof Error ? err.message : 'style fetch failed');
        return;
      }
      if (cancelled || !containerRef.current) return;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: CONFIG.map.initialCenter,
          zoom: CONFIG.map.initialZoom,
          attributionControl: false,
          // lite mode (older phones): flat, no world copies, instant fades
          maxPitch: perfRef.current ? 0 : 65,
          maxZoom: perfRef.current ? 19 : 22,
          renderWorldCopies: false,
          fadeDuration: perfRef.current ? 0 : 300,
          refreshExpiredTiles: false,
          dragRotate: false,
        });
      } catch (err) {
        onStatusRef.current?.('error', err instanceof Error ? err.message : 'WebGL init failed');
        return;
      }
    })().then(() => {
      const m = map;
      if (!m || cancelled) return;
      m.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: OSM_ATTRIBUTION }),
        'bottom-right',
      );

      // GPS accuracy bubble layer
      const ensureAccuracy = () => {
        if (!m.getSource('me-accuracy')) {
          m.addSource('me-accuracy', { type: 'geojson', data: emptyLine });
          m.addLayer({
            id: 'me-accuracy-fill', type: 'fill', source: 'me-accuracy',
            paint: { 'fill-color': getCssVar('--accent'), 'fill-opacity': 0.09 },
          });
          m.addLayer({
            id: 'me-accuracy-line', type: 'line', source: 'me-accuracy',
            paint: { 'line-color': getCssVar('--accent'), 'line-width': 1, 'line-opacity': 0.45 },
          });
        }
      };

      // Persian (name:fa) labels: wrap every symbol layer's text-field in a coalesce
      const applyLabels = () => {
        if (!faLabelsRef.current) return;
        const st = m.getStyle();
        if (!st?.layers) return;
        for (const l of st.layers) {
          if (l.type !== 'symbol') continue;
          const orig = m.getLayoutProperty(l.id, 'text-field');
          if (orig === undefined || orig === null) continue;
          if (!origTextFieldRef.current.has(l.id)) origTextFieldRef.current.set(l.id, orig);
          m.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:fa'], ['get', 'name:en'], ['get', 'name']]);
        }
      };
      const restoreLabels = () => {
        for (const [id, v] of origTextFieldRef.current) {
          try {
            m.setLayoutProperty(id, 'text-field', v as never);
          } catch {
            // layer may be gone after a style swap — fine
          }
        }
        origTextFieldRef.current.clear();
      };
      applyLabelsRef.current = () => (faLabelsRef.current ? applyLabels() : restoreLabels());

      m.on('load', () => {
        styleLoadedRef.current = true;
        window.clearTimeout(styleTimer);
        m.resize();
        ensureAccuracy();
        applyLabels();
        syncDynamic();
        onStatusRef.current?.('ready', undefined, 'gl');
        tileWatchdog = window.setTimeout(() => {
          if (contentTiles.n === 0) {
            onStatusRef.current?.('error', 'style loaded but no map tiles rendered (network blocked?)');
          }
        }, 8000);
      });
      m.on('style.load', () => {
        styleLoadedRef.current = true;
        contentTiles.n = 0;
        ensureAccuracy();
        applyLabels();
        syncDynamic();
      });
      m.on('sourcedata', (e) => {
        const ev = e as { sourceDataType?: string; isSourceLoaded?: boolean };
        if (ev.sourceDataType === 'content' && ev.isSourceLoaded) contentTiles.n += 1;
      });
      m.on('error', (e) => {
        const msg = (e as { error?: { message?: string } }).error?.message ?? 'map error';
        // Pre-load failures (style / WebGL / context loss) mean a blank map -> surface them.
        // After load, single tile/image hiccups are transient and the map still renders -> ignore.
        const fatal = !styleLoadedRef.current || /webgl|context|style/i.test(msg);
        if (fatal && errorCountRef.current++ < 3) {
          onStatusRef.current?.('error', msg);
        } else if (!fatal) {
          console.warn('[lostless] transient map tile error (ignored):', msg);
        }
      });

      // keep the canvas sized to its container (sheet drags / rotation / keyboard)
      const ro = new ResizeObserver(() => m.resize());
      ro.observe(container);
      (m as unknown as { __ro?: ResizeObserver }).__ro = ro;

      // tap = drop destination pin, but ignore taps that were actually drags
      let down: { x: number; y: number } | null = null;
      const downHandler = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        down = { x: e.point.x, y: e.point.y };
      };
      m.on('mousedown', downHandler);
      m.on('touchstart', downHandler);
      m.on('click', (e) => {
        if (down && Math.hypot(e.point.x - down.x, e.point.y - down.y) < 10) {
          onTapRef.current([e.lngLat.lng, e.lngLat.lat]);
        }
        down = null;
      });

      // GPS dot marker
      const meEl = document.createElement('div');
      meEl.className = 'me-marker';
      meEl.innerHTML = '<span class="me-ring"></span><span class="me-dot"></span>';
      meMarkerRef.current = new maplibregl.Marker({ element: meEl, anchor: 'center' });

      // destination pin
      const destEl = document.createElement('div');
      destEl.className = 'dest-marker';
      destMarkerRef.current = new maplibregl.Marker({ element: destEl, anchor: 'center' });

      mapRef.current = m;
      props.onMapReady?.({
        getCenter: () => {
          const c = m.getCenter();
          return [c.lng, c.lat];
        },
        zoomBy: (d: number) => m.zoomTo(m.getZoom() + d),
        centerOn: (ll: [number, number], zoom?: number) => {
          const z = zoom ?? Math.max(m.getZoom(), CONFIG.map.minFollowZoom);
          if (instantRef.current) m.jumpTo({ center: ll, zoom: z });
          else m.easeTo({ center: ll, zoom: z, duration: 500 });
        },
      });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(styleTimer);
      window.clearTimeout(tileWatchdog);
      const m = map;
      if (m) (m as unknown as { __ro?: ResizeObserver }).__ro?.disconnect();
      if (m) m.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme / pinned style → swap map style (layers are re-added on style.load)
  useEffect(() => {
    const map = mapRef.current;
    if (map && styleLoadedRef.current && map.isStyleLoaded()) {
      void resolveStyle(props.theme, props.mapStyle ?? 'auto')
        .then((s) => {
          if (mapRef.current === map) map.setStyle(s);
        })
        .catch(() => {
          /* style swap failure is surfaced by the map error handler */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.theme, props.mapStyle]);

  // fa labels toggle → patch / restore symbol text-fields
  useEffect(() => {
    faLabelsRef.current = props.faLabels ?? false;
    const map = mapRef.current;
    if (map && styleLoadedRef.current && map.isStyleLoaded()) applyLabelsRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.faLabels]);

  // re-sync whenever data changes
  useEffect(() => {
    syncDynamic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route, props.remainingCoords, props.navigating, props.theme]);

  // GPS dot (+ accuracy bubble) — drawn at displayPos when provided (snapped to route)
  useEffect(() => {
    const marker = meMarkerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    const p = props.displayPos ?? props.pos;
    if (!p) return;
    const ll: [number, number] = [p.coords.longitude, p.coords.latitude];
    marker.setLngLat(ll).addTo(map);
    if (styleLoadedRef.current && map.isStyleLoaded()) {
      const src = map.getSource('me-accuracy') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [circlePolygon(ll, Math.max(5, p.coords.accuracy))] },
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.displayPos]);

  // destination pin
  useEffect(() => {
    const marker = destMarkerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    if (props.destination) {
      marker.setLngLat([props.destination.lon, props.destination.lat]).addTo(map);
    } else {
      marker.remove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.destination]);

  // follow GPS while navigating (map rotates to the heading like a sat-nav)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.navigating || !props.follow) return;
    const p = props.displayPos ?? props.pos;
    if (!p) return;
    const { longitude, latitude, heading } = p.coords;
    const last = lastFollowRef.current;
    if (last) {
      const moved = Math.hypot((longitude - last[0]) * 111320 * Math.cos((latitude * Math.PI) / 180), (latitude - last[1]) * 110540);
      if (moved < 4) return;
    }
    lastFollowRef.current = [longitude, latitude];
    const bearing = heading !== null && !Number.isNaN(heading) ? heading : map.getBearing();
    const target = { center: [longitude, latitude] as [number, number], zoom: Math.max(map.getZoom(), CONFIG.map.navigationZoom), bearing };
    if (instantRef.current) {
      map.jumpTo(target);
    } else {
      map.easeTo({ ...target, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.displayPos, props.navigating, props.follow]);

  return <div className="map-container" ref={containerRef} data-testid="map" />;
}

const emptyLine: Feature<LineString> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [] },
};
const lineFeature = (coords: [number, number][]): Feature<LineString> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coords },
});

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#c8ff2e';
}
