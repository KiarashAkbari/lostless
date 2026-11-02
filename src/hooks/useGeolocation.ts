import { useCallback, useEffect, useRef, useState } from 'react';
import type { GpsStatus } from '../types';
import { smoothPosition } from '../lib/navmath';

export interface GeoState {
  status: GpsStatus;
  pos: GeolocationPosition | null;
  retry: () => void;
}

/**
 * Watches the GPS position with maximum precision (high accuracy, no cached
 * fixes: maximumAge 0). When `smooth` is on (browsing), positions are lightly
 * smoothed (exponential moving average) so the dot doesn't jitter; while
 * navigating pass `smooth=false` to get the raw fix at max precision.
 * `retry` re-requests permission. Raw heading/accuracy/speed always come
 * from the latest fix.
 */
export function useGeolocation(smooth = true): GeoState {
  const [status, setStatus] = useState<GpsStatus>('locating');
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const watchId = useRef<number | null>(null);
  const smoothRef = useRef<{ lat: number; lon: number } | null>(null);
  const smoothOnRef = useRef(smooth);
  smoothOnRef.current = smooth;

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
        // smoothing lives in lib/navmath (unit-tested): weak signal smooths
        // harder, strong signal + big jump trusts the new fix. While navigating
        // (smoothOn=false) we keep the raw fix — max precision on screen.
        const { lat, lon } = smoothOnRef.current
          ? smoothPosition(smoothRef.current, c.latitude, c.longitude, accuracy)
          : { lat: c.latitude, lon: c.longitude };
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
