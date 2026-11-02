import type { GpsStatus } from '../types';
import { formatCoord } from '../lib/geo';
import type { Theme } from '../hooks/useTheme';

const GPS_LABEL: Record<GpsStatus, string> = {
  locating: 'Searching…',
  ok: 'Locked',
  denied: 'Denied',
  error: 'No signal',
  unsupported: 'Unsupported',
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
        <button className="chip menu-btn" onClick={onOpenSidebar} aria-label="Open menu" title="Menu">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <div className="logo">
          lostless<span className="cursor">_</span>
        </div>
      </div>
      <div className="top-right">
        {!online && <span className="chip offline">Offline</span>}
        <button
          className={`chip gps ${gpsStatus}`}
          onClick={gpsClickable ? onGpsRetry : undefined}
          title={gpsClickable ? 'Retry location' : 'GPS status'}
        >
          Location · {GPS_LABEL[gpsStatus]}
          {gpsStatus === 'ok' && coords && (
            <span className="coords mono">
              {formatCoord(coords.latitude, coords.longitude)} ±{Math.round(coords.accuracy)} m
            </span>
          )}
        </button>
        <button className="chip theme-btn" onClick={onToggleTheme} title="Toggle light or dark theme" aria-label="Toggle theme">
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="4.2" /><line x1="12" y1="2" x2="12" y2="4.5" /><line x1="12" y1="19.5" x2="12" y2="22" />
              <line x1="2" y1="12" x2="4.5" y2="12" /><line x1="19.5" y1="12" x2="22" y2="12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          )}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </header>
  );
}
