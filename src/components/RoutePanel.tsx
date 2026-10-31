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

const MODES: TravelMode[] = ['car', 'walk', 'bike'];

export function RoutePanel(props: RoutePanelProps) {
  const { destination, route, routeStatus, mode, onMode, navigating, onStart, onStop, onClear, onRetry, isFav, onToggleFav } = props;
  return (
    <div className="route-panel">
      <div className="route-dest">
        <span className="dest-pin" aria-hidden>◆</span>
        <span className="dest-name" title={destination.name}>{destination.name}</span>
        <button className={`icon-btn mono${isFav ? ' fav' : ''}`} onClick={onToggleFav} title={isFav ? 'remove from saved' : 'save place'} aria-label="toggle favorite">
          {isFav ? '★' : '☆'}
        </button>
        <button className="icon-btn mono" onClick={onClear} title="clear destination" aria-label="clear destination">×</button>
      </div>

      {routeStatus === 'loading' && <div className="mono dim route-note">CALCULATING ROUTE<span className="dots">…</span></div>}
      {routeStatus === 'error' && (
        <div className="mono route-note err">
          ROUTE FAILED — SERVER DOWN OR NO ROUTE
          <button className="mini-btn mono" onClick={onRetry}>RETRY</button>
        </div>
      )}

      {route && routeStatus === 'ok' && (
        <>
          <div className="route-stats mono">
            <span>DIST // {formatDistance(route.distanceM)}</span>
            <span>TIME // {formatDuration(route.durationS)}</span>
            <span>ETA // {formatEta(route.durationS)}</span>
          </div>
          <div className="mode-switch mono" role="group" aria-label="travel mode">
            {MODES.map((m) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => onMode(m)}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          {navigating ? (
            <button className="btn primary stop" onClick={onStop}>■ STOP NAVIGATION</button>
          ) : (
            <button className="btn primary" onClick={onStart}>▶ START</button>
          )}
        </>
      )}
    </div>
  );
}
