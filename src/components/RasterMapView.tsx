import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CONFIG, svcUrl } from '../config';
import type { MapViewProps } from './MapView';

/**
 * Fallback map for devices without WebGL2 (old WebViews): Leaflet + OSM raster
 * tiles. Same props as the GL map, so App doesn't care which renderer is active.
 * Loaded lazily — it only ships to devices that need it.
 */
export function RasterMapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const accRef = useRef<L.Circle | null>(null);
  const destRef = useRef<L.Marker | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const restRef = useRef<L.Polyline | null>(null);
  const fittedRef = useRef(false);

  const dataRef = useRef(props);
  dataRef.current = props;
  const onTapRef = useRef(props.onMapTap);
  onTapRef.current = props.onMapTap;
  const onStatusRef = useRef(props.onStatus);
  onStatusRef.current = props.onStatus;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || (props.perf ?? false);
  const toLatLng = (c: [number, number]): [number, number] => [c[1], c[0]];

  // init
  useEffect(() => {
    if (!containerRef.current) return;
    onStatusRef.current?.('loading', undefined, 'raster');
    let map: L.Map;
    try {
      map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        center: toLatLng(CONFIG.map.initialCenter),
        zoom: CONFIG.map.initialZoom,
        minZoom: 3,
      });
    } catch (err) {
      onStatusRef.current?.('error', err instanceof Error ? err.message : 'map init failed', 'raster');
      return;
    }
    // in the Arena preview, tiles go through the same-origin proxy as well
    L.tileLayer(svcUrl(CONFIG.map.osmRasterUrl), {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => onTapRef.current([e.latlng.lng, e.latlng.lat]));
    map.on('load', () => onStatusRef.current?.('ready', undefined, 'raster'));
    const t = setTimeout(() => onStatusRef.current?.('ready', undefined, 'raster'), 1500);
    // keep tile layout correct when the container resizes (sheet drags, rotation)
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    mapRef.current = map;
    props.onMapReady?.({
      getCenter: () => {
        const c = map.getCenter();
        return [c.lng, c.lat];
      },
      zoomBy: (d: number) => map.setZoom(map.getZoom() + d),
      centerOn: (ll: [number, number], zoom?: number) =>
        map.setView(toLatLng(ll), zoom ?? Math.max(map.getZoom(), CONFIG.map.minFollowZoom), { animate: !reduced() }),
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GPS dot + accuracy (dot drawn at displayPos when snapped to the route)
  useEffect(() => {
    const map = mapRef.current;
    const p = props.displayPos ?? props.pos;
    if (!map || !p) return;
    const { latitude, longitude, accuracy } = p.coords;
    if (!meRef.current) {
      meRef.current = L.circleMarker([latitude, longitude], {
        radius: 7, color: '#0b0d0e', weight: 2, fillColor: '#c8ff2e', fillOpacity: 1,
      }).addTo(map);
      accRef.current = L.circle([latitude, longitude], {
        radius: accuracy, color: '#c8ff2e', weight: 1, fillColor: '#c8ff2e', fillOpacity: 0.08,
      }).addTo(map);
    } else {
      meRef.current.setLatLng([latitude, longitude]);
      accRef.current?.setLatLng([latitude, longitude]).setRadius(accuracy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.displayPos]);

  // destination pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (props.destination) {
      if (!destRef.current) {
        destRef.current = L.marker(toLatLng([props.destination.lon, props.destination.lat]), {
          icon: L.divIcon({ className: 'dest-marker-wrap', html: '<div class="dest-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        }).addTo(map);
      } else {
        destRef.current.setLatLng(toLatLng([props.destination.lon, props.destination.lat]));
      }
    } else if (destRef.current) {
      destRef.current.remove();
      destRef.current = null;
      fittedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.destination]);

  // route lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routeRef.current) {
      routeRef.current.remove();
      routeRef.current = null;
    }
    if (restRef.current) {
      restRef.current.remove();
      restRef.current = null;
    }
    const { route, remainingCoords, navigating } = dataRef.current;
    if (route?.coords?.length) {
      const pts = route.coords.map(toLatLng);
      routeRef.current = L.polyline(pts, {
        color: '#c8ff2e', weight: 6, opacity: navigating ? 0.4 : 1, lineJoin: 'round',
      }).addTo(map);
      if (!navigating && !fittedRef.current) {
        fittedRef.current = true;
        map.fitBounds(routeRef.current.getBounds(), { padding: [40, 40] });
      }
      if (navigating && remainingCoords?.length) {
        restRef.current = L.polyline(remainingCoords.map(toLatLng), {
          color: '#c8ff2e', weight: 6, opacity: 1, lineJoin: 'round',
        }).addTo(map);
      }
    } else {
      fittedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route, props.remainingCoords, props.navigating]);

  // follow GPS while navigating
  useEffect(() => {
    const map = mapRef.current;
    const p = props.displayPos ?? props.pos;
    if (!map || !props.navigating || !props.follow || !p) return;
    const { latitude, longitude } = p.coords;
    map.setView([latitude, longitude], Math.max(map.getZoom(), CONFIG.map.navigationZoom), { animate: !reduced() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pos, props.navigating, props.follow]);

  return (
    <div
      className={`map-container raster ${props.theme}`}
      ref={containerRef}
      data-testid="map-raster"
    />
  );
}
