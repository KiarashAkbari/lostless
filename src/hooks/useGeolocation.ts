import { useCallback, useEffect, useRef, useState } from 'react';
import type { GpsStatus } from '../types';
import { kalmanSpeed, kalmanUpdate, type KalmanState } from '../lib/navmath';

export interface GeoState {
  status: GpsStatus;
  pos: GeolocationPosition | null;
  /** age of the newest fix in ms, useful for detecting a lost signal */
  fixAgeMs: number;
  retry: () => void;
}

/**
 * Watches the GPS position with maximum precision (high accuracy, no cached
 * fixes: maximumAge 0). Every fix is folded into a constant-velocity Kalman
 * filter (see lib/navmath) that fuses position with the platform's Doppler
 * speed: the dot stops drifting while standing still, follows a car with
 * almost no lag, and yields a trustworthy speed/heading when the platform
 * reports `speed: null` (common on iOS and desktop).
 *
 * `smooth=false` (navigating) tightens the process noise so the arrow sits on
 * the road rather than trailing the driver.
 */
export function useGeolocation(smooth = true): GeoState {
  const [status, setStatus] = useState<GpsStatus>('locating');
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [fixAgeMs, setFixAgeMs] = useState(0);
  const watchId = useRef<number | null>(null);
  const kalman = useRef<KalmanState | null>(null);
  const lastFixAt = useRef(0);
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
        const rawSpeed = Number.isFinite(c.speed) ? c.speed : null;
        const rawHeading = Number.isFinite(c.heading) ? c.heading : null;

        // filter lives in lib/navmath (unit-tested). Navigating gets lower
        // process noise: the estimate should hug the road, not lag the car.
        const res = kalmanUpdate(kalman.current, c.longitude, c.latitude, accuracy, p.timestamp, {
          speed: rawSpeed,
          q: smoothOnRef.current ? 0.6 : 0.25,
        });
        kalman.current = res.state;
        lastFixAt.current = Date.now();

        // speed: prefer Doppler, fall back to the filter's own estimate
        const speed = rawSpeed !== null ? rawSpeed : kalmanSpeed(res.state);
        const smoothed = {
          ...p,
          coords: {
            ...c,
            latitude: res.lat,
            longitude: res.lon,
            accuracy,
            speed,
            heading: rawHeading,
          },
        } as GeolocationPosition;
        setPos(smoothed);
        setFixAgeMs(0);
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

  // fix age ticker: lets the UI say "signal lost" instead of silently freezing
  useEffect(() => {
    if (!pos) return;
    const id = window.setInterval(() => {
      setFixAgeMs(lastFixAt.current ? Date.now() - lastFixAt.current : 0);
    }, 3000);
    return () => window.clearInterval(id);
  }, [pos]);

  return { status, pos, fixAgeMs, retry: start };
}
