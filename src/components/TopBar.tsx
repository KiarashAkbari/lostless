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
  onOpenSidebar: () => void;
  gpsStatus: GpsStatus;
  onGpsRetry: () => void;
  online: boolean;
  coords: { latitude: number; longitude: number; accuracy: number } | null;
}

export function TopBar({ theme, onToggleTheme, onOpenSidebar, gpsStatus, onGpsRetry, online, coords }: TopBarProps) {
  const gpsClickable = gpsStatus === 'denied' || gpsStatus === 'error';
  return (
    <header className="topbar">
      <div className="top-left">
        <button className="chip mono menu-btn" onClick={onOpenSidebar} aria-label="open menu" title="menu">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <div className="logo mono">
          lostless<span className="cursor">_</span>
        </div>
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
