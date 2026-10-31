import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, LineString } from 'geojson';
import { CONFIG } from '../config';
import type { Place, RouteResult } from '../types';
import type { Theme } from '../hooks/useTheme';

export interface MapApi {
  getCenter: () => [number, number];
  zoomBy: (delta: number) => void;
  centerOn: (ll: [number, number], zoom?: number) => void;
}

export type MapStatus = 'loading' | 'ready' | 'error';

export interface MapViewProps {
  theme: Theme;
  pos: GeolocationPosition | null;
  destination: Place | null;
  route: RouteResult | null;
  /** while navigating: polyline from the current position to the destination */
  remainingCoords: [number, number][] | null;
  navigating: boolean;
  follow: boolean;
  onMapTap: (lngLat: [number, number]) => void;
  /** lets the parent read the map center (fallback origin) and drive zoom/center */
  onMapReady?: (api: MapApi) => void;
  /** map lifecycle reporting so the UI can show loading / error states */
  onStatus?: (s: MapStatus, msg?: string) => void;
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
  // MapLibre v5 needs WebGL2; without it we render the raster fallback instead
  const supported = useMemo(() => webgl2Supported(), []);
  if (!supported) {
    return (
      <Suspense fallback={<MapLoading />}>
        <RasterMapView {...props} />
      </Suspense>
    );
  }
  return <GlMapView {...props} />;
}

const styleFor = (theme: Theme) => (theme === 'dark' ? CONFIG.map.darkStyleUrl : CONFIG.map.lightStyleUrl);

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

  // latest data for callbacks / style reloads (avoid stale closures)
  const dataRef = useRef({ theme: props.theme, pos: props.pos, destination: props.destination, route: props.route, remaining: props.remainingCoords, navigating: props.navigating });
  dataRef.current = { theme: props.theme, pos: props.pos, destination: props.destination, route: props.route, remaining: props.remainingCoords, navigating: props.navigating };
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
    if (!containerRef.current) return;
    onStatusRef.current?.('loading');
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleFor(dataRef.current.theme),
        center: CONFIG.map.initialCenter,
        zoom: CONFIG.map.initialZoom,
        attributionControl: false,
        maxPitch: 65,
        dragRotate: false,
      });
    } catch (err) {
      onStatusRef.current?.('error', err instanceof Error ? err.message : 'WebGL init failed');
      return;
    }
    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: OSM_ATTRIBUTION }),
      'bottom-right',
    );

    map.on('load', () => {
      styleLoadedRef.current = true;
      syncDynamic();
      onStatusRef.current?.('ready');
    });
    map.on('style.load', () => {
      styleLoadedRef.current = true;
      syncDynamic();
    });
    map.on('error', (e) => {
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

    // tap = drop destination pin, but ignore taps that were actually drags
    let down: { x: number; y: number } | null = null;
    const downHandler = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      down = { x: e.point.x, y: e.point.y };
    };
    map.on('mousedown', downHandler);
    map.on('touchstart', downHandler);
    map.on('click', (e) => {
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

    mapRef.current = map;
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    props.onMapReady?.({
      getCenter: () => {
        const c = map.getCenter();
        return [c.lng, c.lat];
      },
      zoomBy: (d: number) => map.zoomTo(map.getZoom() + d),
      centerOn: (ll: [number, number], zoom?: number) => {
        const z = zoom ?? Math.max(map.getZoom(), CONFIG.map.minFollowZoom);
        if (reduced()) map.jumpTo({ center: ll, zoom: z });
        else map.easeTo({ center: ll, zoom: z, duration: 500 });
      },
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme → swap map style (layers are re-added on style.load)
  useEffect(() => {
    const map = mapRef.current;
    if (map && styleLoadedRef.current && map.isStyleLoaded()) {
      map.setStyle(styleFor(props.theme));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.theme]);

  // re-sync whenever data changes
  useEffect(() => {
    syncDynamic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route, props.remainingCoords, props.navigating, props.theme]);

  // GPS dot
  useEffect(() => {
    const marker = meMarkerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    if (props.pos) {
      marker.setLngLat([props.pos.coords.longitude, props.pos.coords.latitude]).addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos]);

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

  // follow GPS while navigating
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.navigating || !props.follow || !props.pos) return;
    const { longitude, latitude, heading } = props.pos.coords;
    const last = lastFollowRef.current;
    if (last) {
      const moved = Math.hypot((longitude - last[0]) * 111320 * Math.cos((latitude * Math.PI) / 180), (latitude - last[1]) * 110540);
      if (moved < 4) return;
    }
    lastFollowRef.current = [longitude, latitude];
    const bearing = heading !== null && !Number.isNaN(heading) ? heading : map.getBearing();
    const target = { center: [longitude, latitude] as [number, number], zoom: Math.max(map.getZoom(), CONFIG.map.navigationZoom), bearing };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.jumpTo(target);
    } else {
      map.easeTo({ ...target, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.navigating, props.follow]);

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
