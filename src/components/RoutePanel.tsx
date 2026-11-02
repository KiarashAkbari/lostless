import type { TravelMode } from '../config';
import type { Place, RouteAvoid, RouteResult } from '../types';
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
  /** roads to steer around — re-routes as soon as one is switched */
  avoid?: RouteAvoid;
  onAvoid?: (a: RouteAvoid) => void;
  /** intermediate stops, shown between "start" and the destination */
  stops?: Place[];
  onRemoveStop?: (id: string) => void;
}

const MODES: Array<{ id: TravelMode; label: string }> = [
  { id: 'car', label: 'Car' },
  { id: 'walk', label: 'Walk' },
  { id: 'bike', label: 'Bike' },
];

const AVOID_CHOICES: Array<{ id: keyof RouteAvoid; label: string }> = [
  { id: 'tolls', label: 'Tolls' },
  { id: 'highways', label: 'Motorways' },
  { id: 'ferries', label: 'Ferries' },
];

export function RoutePanel(props: RoutePanelProps) {
  const { destination, route, routeStatus, mode, onMode, navigating, onStart, onStop, onClear, onRetry, isFav, onToggleFav, avoid, onAvoid, stops, onRemoveStop } = props;
  // the switches only mean something for a vehicle: a walker never pays a toll
  const canAvoid = mode === 'car';
  const avoidList = avoid ? AVOID_CHOICES.filter((c) => avoid[c.id]) : [];
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

      {stops && stops.length > 0 && (
        <ul className="stop-list">
          {stops.map((sp, i) => (
            <li key={sp.id}>
              <span className="stop-dot mono" aria-hidden>{i + 1}</span>
              <span className="stop-name" title={sp.name}>{sp.name}</span>
              {onRemoveStop && (
                <button className="icon-btn" onClick={() => onRemoveStop(sp.id)} aria-label={`Remove stop ${sp.name.split(',')[0]}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

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
          {canAvoid && avoid && onAvoid && (
            <div className="avoid-row" role="group" aria-label="Avoid">
              <span className="dim avoid-label">Avoid</span>
              {AVOID_CHOICES.map((c) => (
                <button
                  key={c.id}
                  className={`chip avoid${avoid[c.id] ? ' on' : ''}`}
                  onClick={() => onAvoid({ ...avoid, [c.id]: !avoid[c.id] })}
                  aria-pressed={avoid[c.id]}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {(route.hasToll || route.hasFerry || (route.hasHighway && avoidList.some((c) => c.id === 'highways'))) && (
            <div className="route-note dim">
              {route.hasToll && 'This route has tolls. '}
              {route.hasFerry && 'It includes a ferry crossing. '}
              {route.hasHighway && avoidList.some((c) => c.id === 'highways') && 'Motorways could not be avoided everywhere.'}
            </div>
          )}
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
