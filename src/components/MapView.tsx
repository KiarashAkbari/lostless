import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, LineString } from 'geojson';
import { CONFIG, previewProxied, svcUrl, rewriteStyleUrls, styleUrlFor, type MapStyle } from '../config';
import { buildBaseStyle, type TileBase } from '../lib/mapStyle';
import { chooseTileBase } from '../lib/tilebase';
import type { Place, RouteResult } from '../types';
import type { Theme } from '../hooks/useTheme';
import { bearingDeg, circlePolygon, haversineM } from '../lib/geo';

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
  /** frame a whole route, leaving the floating sheet and nav card visible */
  fitRoute: (coords: [number, number][]) => void;
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
  /** camera zoom while navigating: speed zone + turn pull-in (lib/guidance) */
  navZoom?: number;
  /** camera + arrow heading while navigating (fused in lib/guidance.pickHeading) */
  navHeading?: number | null;
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
      <span>Loading map<span className="dots">…</span></span>
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

let tileBasePromise: Promise<TileBase | null> | null = null;

/** resolved once per session: direct tile host first, same-origin proxy second */
function resolveTileBase(): Promise<TileBase | null> {
  if (!tileBasePromise) tileBasePromise = chooseTileBase();
  return tileBasePromise;
}

/** a failed probe must not be remembered forever: "try again" re-runs it */
export function forgetTileBase(): void {
  tileBasePromise = null;
}

/**
 * Resolve the map style for a theme.
 *
 * Our own basemap (lib/mapStyle) is used for 'auto' / 'dark' / 'light': it is a
 * plain object, so there is no style request at all and the first tiles can
 * start loading immediately. 'liberty' / 'bright' stay available as classic
 * OpenFreeMap styles (fetched once, then cached by the service worker).
 */
async function resolveStyle(theme: Theme, mapStyle: MapStyle = 'auto'): Promise<string | maplibregl.StyleSpecification> {
  if (mapStyle !== 'liberty' && mapStyle !== 'bright') {
    const base = mapStyle === 'dark' ? 'dark' : mapStyle === 'light' ? 'light' : theme;
    const tileBase = await resolveTileBase();
    if (!tileBase) throw new Error('no tile server reachable');
    return buildBaseStyle(base, tileBase);
  }
  // classic styles are remote documents: proxy them in the preview, where the
  // sandbox may be the only route to the host
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
  const lastDotRef = useRef<[number, number] | null>(null);
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
      // route lines belong *under* the street labels, like any decent map
      const firstSymbol = (map.getStyle().layers ?? []).find((l) => l.type === 'symbol')?.id;
      const before = firstSymbol;
      const casing = getCssVar('--route-casing') || '#000';
      map.addLayer({
        id: 'route-full-casing', type: 'line', source: 'route-full',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': casing, 'line-width': 10, 'line-opacity': 0.55 },
      }, before);
      map.addLayer({
        id: 'route-full-line', type: 'line', source: 'route-full',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': navigating ? routeColor : accent, 'line-width': 6, 'line-opacity': navigating ? 0.45 : 1 },
      }, before);
      map.addLayer({
        id: 'route-rest-casing', type: 'line', source: 'route-rest',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': casing, 'line-width': 10, 'line-opacity': 0.55 },
      }, before);
      map.addLayer({
        id: 'route-rest-line', type: 'line', source: 'route-rest',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': accent, 'line-width': 6 },
      }, before);
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
    // a fresh map (first mount, or after "try again") re-probes the tile host
    forgetTileBase();
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
          // 3D works in lite mode too (the nav angle is the point of nav mode);
          // lite mode saves its GPU budget on blur, MSAA and pixel density
          maxPitch: 65,
          maxZoom: perfRef.current ? 19 : 22,
          renderWorldCopies: false,
          // tiles appear the moment they arrive instead of fading in over 300 ms
          // (that fade is what makes panning feel slow)
          fadeDuration: 0,
          refreshExpiredTiles: false,
          dragRotate: false,
          // cheaper label placement: one collision pass across sources
          crossSourceCollisions: false,
          // render at 2x at most — a 3x phone screen costs 2.25x the pixels for
          // no visible gain over a map
          pixelRatio: Math.min(window.devicePixelRatio || 1, perfRef.current ? 1.5 : 2),
          // no MSAA (big win on mobile GPUs), no buffer preservation, bigger
          // tile cache so panning back doesn't refetch
          canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' },
          maxTileCacheSize: perfRef.current ? 64 : 256,
          // the container has its own ResizeObserver below — skip MapLibre's
          trackResize: false,
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
        'bottom-left',
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

      // while the user drags the map, skip the big frosted panels' backdrop
      // blur: compositing a live WebGL canvas through them is the expensive
      // part. Only real gestures (originalEvent) toggle this, so the sat-nav
      // camera easing does not flicker.
      const setMoving = (on: boolean) => document.body.classList.toggle('map-moving', on);
      m.on('movestart', (e) => {
        if ((e as { originalEvent?: unknown }).originalEvent) setMoving(true);
      });
      m.on('moveend', () => setMoving(false));

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

      // GPS arrow marker — rotates with the heading (rotationAlignment 'map')
      const meEl = document.createElement('div');
      meEl.className = 'me-marker';
      meEl.innerHTML = '<span class="me-ring"></span><span class="me-arrow"></span>';
      meMarkerRef.current = new maplibregl.Marker({ element: meEl, anchor: 'center', rotationAlignment: 'map' });

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
        fitRoute: (coords: [number, number][]) => {
          const pts = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
          if (!pts.length) return;
          let [w, s0, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
          for (const [lon, lat] of pts) {
            w = Math.min(w, lon); e = Math.max(e, lon);
            s0 = Math.min(s0, lat); n = Math.max(n, lat);
          }
          const sheet = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || 0;
          m.fitBounds([[w, s0], [e, n]], {
            padding: { top: 96, right: 44, bottom: Math.round(sheet) + 28, left: 44 },
            maxZoom: 16.5,
            duration: instantRef.current ? 0 : 750,
          });
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
      document.body.classList.remove('map-moving');
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
    if (!Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return; // never feed NaN to maplibre
    marker.setLngLat(ll).addTo(map);
    // heading first; otherwise the direction we actually moved (GPS heading is
    // null while slow — the arrow would point north and look broken)
    const hd = p.coords.heading;
    const prev = lastDotRef.current;
    const moved = prev ? bearingDeg(prev, ll) : null;
    lastDotRef.current = ll;
    const fused = props.navHeading;
    if (fused !== null && fused !== undefined && Number.isFinite(fused)) marker.setRotation(fused);
    else if (hd !== null && Number.isFinite(hd)) marker.setRotation(hd);
    else if (moved !== null && prev && haversineM(prev, ll) > 3) marker.setRotation(moved);
    if (styleLoadedRef.current && map.isStyleLoaded()) {
      const src = map.getSource('me-accuracy') as maplibregl.GeoJSONSource | undefined;
      const acc = Number.isFinite(p.coords.accuracy) && p.coords.accuracy > 0 ? p.coords.accuracy : 25;
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [circlePolygon(ll, acc)] },
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.displayPos, props.navHeading]);

  // destination pin
  useEffect(() => {
    const marker = destMarkerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    if (props.destination && Number.isFinite(props.destination.lon) && Number.isFinite(props.destination.lat)) {
      marker.setLngLat([props.destination.lon, props.destination.lat]).addTo(map);
    } else {
      marker.remove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.destination]);

  // the sat-nav camera: tilted, rotated to the direction of travel, car pushed
  // down the screen so most of what you see is the road ahead. A positive top
  // padding moves the centre point below the middle of the viewport.
  const navCamera = (map: maplibregl.Map, center?: [number, number], bearing?: number) => {
    const h = map.getContainer?.().clientHeight || 0;
    // the zoom comes from lib/guidance: wide at speed, closer at a junction
    const wanted = props.navZoom;
    const zoom = Number.isFinite(wanted) ? Math.max(14, Math.min(19, wanted as number)) : CONFIG.map.navigationZoom;
    return {
      ...(center ? { center } : {}),
      zoom,
      pitch: CONFIG.map.navPitch,
      ...(bearing !== undefined && Number.isFinite(bearing) ? { bearing } : {}),
      padding: { top: Math.round(h * 0.2), right: 0, bottom: 0, left: 0 },
    };
  };

  // entering / leaving navigation mode tilts and flattens the map right away,
  // without waiting for the first GPS step
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.navigating) {
      // drop the tilt and the nav offset, otherwise the map stays shifted
      const flat = { pitch: 0, bearing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
      if (instantRef.current) {
        map.jumpTo({ pitch: 0, bearing: 0 });
        map.setPadding?.(flat.padding);
      } else {
        map.easeTo({ ...flat, duration: 550 });
      }
      lastFollowRef.current = null;
      return;
    }
    const p = props.displayPos ?? props.pos;
    const ok = p && Number.isFinite(p.coords.longitude) && Number.isFinite(p.coords.latitude);
    const center: [number, number] | undefined = ok ? [p!.coords.longitude, p!.coords.latitude] : undefined;
    const hd = p?.coords.heading;
    const bearing = hd !== null && hd !== undefined && Number.isFinite(hd) ? hd : undefined;
    const target = navCamera(map, center, bearing);
    if (instantRef.current) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.navigating]);

  // follow GPS while navigating (keeps the tilt, re-centres on movement)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.navigating || !props.follow) return;
    const p = props.displayPos ?? props.pos;
    if (!p) return;
    const { longitude, latitude, heading } = p.coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    const last = lastFollowRef.current;
    if (last) {
      const moved = haversineM(last, [longitude, latitude]);
      if (moved < 4) return;
    }
    lastFollowRef.current = [longitude, latitude];
    // heading can be null or NaN/Infinity on some WebViews — only trust finite values
    const movedBearing = last ? bearingDeg(last, [longitude, latitude]) : null;
    // the parent fuses GPS course + the road ahead + movement (lib/guidance),
    // so its heading wins; the rest are fallbacks for the first few fixes
    const fused = props.navHeading;
    const bearing =
      fused !== null && fused !== undefined && Number.isFinite(fused)
        ? fused
        : heading !== null && Number.isFinite(heading)
          ? heading
          : movedBearing !== null && haversineM(last!, [longitude, latitude]) > 3
            ? movedBearing
            : map.getBearing();
    const target = navCamera(map, [longitude, latitude], bearing);
    if (instantRef.current) {
      map.jumpTo(target);
    } else {
      map.easeTo({ ...target, duration: 650 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.displayPos, props.navigating, props.follow, props.navZoom, props.navHeading]);

  return <div className={`map-container ${props.theme}${props.perf ? ' perf' : ''}`} ref={containerRef} data-testid="map" />;
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
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#eceded';
}
