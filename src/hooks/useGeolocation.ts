import { useCallback, useEffect, useRef, useState } from 'react';
import type { GpsStatus } from '../types';

export interface GeoState {
  status: GpsStatus;
  pos: GeolocationPosition | null;
  retry: () => void;
}

/** Watches the GPS position. Starts automatically; `retry` re-requests permission. */
export function useGeolocation(): GeoState {
  const [status, setStatus] = useState<GpsStatus>('locating');
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const watchId = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus((s) => (s === 'ok' ? s : 'locating'));
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos(p);
        setStatus('ok');
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 },
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
