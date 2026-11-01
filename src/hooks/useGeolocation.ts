import { useCallback, useEffect, useRef, useState } from 'react';
import type { GpsStatus } from '../types';
import { haversineM } from '../lib/geo';

export interface GeoState {
  status: GpsStatus;
  pos: GeolocationPosition | null;
  retry: () => void;
}

/**
 * Watches the GPS position with high accuracy and lightly smooths it
 * (exponential moving average) so the blue dot doesn't jitter on screen.
 * `retry` re-requests permission. Raw heading/accuracy/speed always come
 * from the latest fix.
 */
export function useGeolocation(): GeoState {
  const [status, setStatus] = useState<GpsStatus>('locating');
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const watchId = useRef<number | null>(null);
  const smoothRef = useRef<{ lat: number; lon: number } | null>(null);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus((s) => (s === 'ok' ? s : 'locating'));
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const c = p.coords;
        // some WebViews deliver NaN accuracy/speed/heading — never let those through
        // (Leaflet's L.circle throws "Circle radius cannot be NaN", maplibre rejects NaN lngLat)
        if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return; // ignore broken fix
        const accuracy = Number.isFinite(c.accuracy) && c.accuracy > 0 ? c.accuracy : 50;
        const speed = Number.isFinite(c.speed) ? c.speed : null;
        const heading = Number.isFinite(c.heading) ? c.heading : null;
        const prev = smoothRef.current;
        let lat = c.latitude;
        let lon = c.longitude;
        if (prev) {
          const moved = haversineM([prev.lon, prev.lat], [c.longitude, c.latitude]);
          // strong signal + big jump → trust the new fix; weak signal → smooth harder
          const alpha = accuracy > 60 ? 0.8 : moved > 25 ? 0.7 : moved > 3 ? 0.45 : 0.2;
          lat = prev.lat + (c.latitude - prev.lat) * alpha;
          lon = prev.lon + (c.longitude - prev.lon) * alpha;
        }
        smoothRef.current = { lat, lon };
        const smoothed = {
          ...p,
          coords: { ...c, latitude: lat, longitude: lon, accuracy, speed, heading },
        } as GeolocationPosition;
        setPos(smoothed);
        setStatus('ok');
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      // precise tracking: always ask for the best fix, never a cached one
      { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 },
    );
  }, []);

  useEffect(() => {
    start();
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [start]);

  return { status, pos, retry: start };
}
