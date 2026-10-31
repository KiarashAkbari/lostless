import type { GpsStatus } from '../types';
import { formatCoord } from '../lib/geo';
import type { Theme } from '../hooks/useTheme';

const GPS_LABEL: Record<GpsStatus, string> = {
  locating: 'SEARCHING…',
  ok: 'LOCKED',
  denied: 'DENIED',
  error: 'ERROR',
  unsupported: 'N/A',
};

interface TopBarProps {
  theme: Theme;
  onToggleTheme: () => void;
  gpsStatus: GpsStatus;
  onGpsRetry: () => void;
  online: boolean;
  coords: { latitude: number; longitude: number; accuracy: number } | null;
}

export function TopBar({ theme, onToggleTheme, gpsStatus, onGpsRetry, online, coords }: TopBarProps) {
  const gpsClickable = gpsStatus === 'denied' || gpsStatus === 'error';
  return (
    <header className="topbar">
      <div className="logo mono">
        lostless<span className="cursor">_</span>
      </div>
      <div className="top-right">
        {!online && <span className="chip mono offline">OFFLINE</span>}
        <button
          className={`chip mono gps ${gpsStatus}`}
          onClick={gpsClickable ? onGpsRetry : undefined}
          title={gpsClickable ? 'retry location' : 'GPS status'}
        >
          GPS ▸ {GPS_LABEL[gpsStatus]}
          {gpsStatus === 'ok' && coords && (
            <span className="coords">
              {' '}
              {formatCoord(coords.latitude, coords.longitude)} ±{Math.round(coords.accuracy)}m
            </span>
          )}
        </button>
        <button className="chip mono theme-btn" onClick={onToggleTheme} title="toggle light / dark">
          {theme === 'dark' ? '◐ LIGHT' : '◐ DARK'}
        </button>
      </div>
    </header>
  );
}
