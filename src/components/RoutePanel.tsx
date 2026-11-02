import type { TravelMode } from '../config';
import type { Place, RouteResult } from '../types';
import { formatDistance, formatDuration, formatEta } from '../lib/geo';

interface RoutePanelProps {
  destination: Place;
  route: RouteResult | null;
  routeStatus: 'idle' | 'loading' | 'ok' | 'error';
  mode: TravelMode;
  onMode: (m: TravelMode) => void;
  navigating: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onRetry: () => void;
  isFav: boolean;
  onToggleFav: () => void;
}

const MODES: Array<{ id: TravelMode; label: string }> = [
  { id: 'car', label: 'Car' },
  { id: 'walk', label: 'Walk' },
  { id: 'bike', label: 'Bike' },
];

export function RoutePanel(props: RoutePanelProps) {
  const { destination, route, routeStatus, mode, onMode, navigating, onStart, onStop, onClear, onRetry, isFav, onToggleFav } = props;
  return (
    <div className="route-panel">
      <div className="route-dest">
        <span className="dest-pin" aria-hidden>◆</span>
        <span className="dest-name" title={destination.name}>{destination.name}</span>
        <button className={`icon-btn${isFav ? ' fav' : ''}`} onClick={onToggleFav} title={isFav ? 'Remove from saved' : 'Save this place'} aria-label="Toggle favorite">
          {isFav ? '★' : '☆'}
        </button>
        <button className="icon-btn" onClick={onClear} title="Clear" aria-label="Clear destination">×</button>
      </div>

      {routeStatus === 'loading' && <div className="dim route-note">Working out the route<span className="dots">…</span></div>}
      {routeStatus === 'error' && (
        <div className="route-note err">
          No route came back. The server may be busy.
          <button className="mini-btn" onClick={onRetry}>Try again</button>
        </div>
      )}

      {route && routeStatus === 'ok' && (
        <>
          <div className="route-stats">
            <span>Distance <b>{formatDistance(route.distanceM)}</b></span>
            <span>Time <b>{formatDuration(route.durationS)}</b></span>
            <span>Arrive <b>{formatEta(route.durationS)}</b></span>
          </div>
          <div className="mode-switch" role="group" aria-label="Travel mode">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => onMode(m.id)} aria-pressed={mode === m.id}>
                {m.label}
              </button>
            ))}
          </div>
          {navigating ? (
            <button className="btn primary stop" onClick={onStop}>End navigation</button>
          ) : (
            <button className="btn primary" onClick={onStart}>Start</button>
          )}
        </>
      )}
    </div>
  );
}
