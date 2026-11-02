import type { TravelMode } from '../config';
import type { RouteStep } from '../types';
import { maneuverGlyph, maneuverLabel } from '../lib/maneuvers';
import { formatDistance, formatDuration, formatEta } from '../lib/geo';

interface NavOverlayProps {
  step: RouteStep | undefined;
  distToNextM: number;
  remainingM: number;
  remainingS: number;
  speedKmh: number | null;
  /** 0..1 fraction of the route already covered */
  progress: number;
  mode: TravelMode;
  onStop: () => void;
}

const MODE_LABEL: Record<TravelMode, string> = { car: 'Drive', walk: 'Walk', bike: 'Bike' };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Navigation mode readout (sat-nav style): a big next-turn card on top, route
 * progress bar, and an ETA / speed strip with a stop button. Numbers are the
 * only monospace text here.
 */
export function NavOverlay({ step, distToNextM, remainingM, remainingS, speedKmh, progress, mode, onStop }: NavOverlayProps) {
  // a route with zero steps still needs the overlay (stop button, ETA) — show a fallback card
  const glyph = step ? maneuverGlyph(step) : '◦';
  const label = step ? cap(maneuverLabel(step)) : 'On the way';
  const street = step ? step.street || step.instruction : '';
  return (
    <div className="nav-overlay">
      <div className="nav-main">
        <span className="nav-glyph" aria-hidden>{glyph}</span>
        <div className="nav-text">
          <div className="nav-in">
            <span className="mono nav-dist">{formatDistance(distToNextM)}</span> {label}
          </div>
          <div className="nav-street">{street}</div>
        </div>
        <span className="chip nav-mode">{MODE_LABEL[mode]}</span>
      </div>
      <div className="nav-progress" aria-hidden>
        <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
      </div>
      <div className="nav-sub">
        <span>Arrive <span className="mono">{formatEta(remainingS)}</span></span>
        <span className="mono">{formatDuration(remainingS)}</span>
        <span><span className="mono">{formatDistance(remainingM)}</span> left</span>
        <span className="mono">{speedKmh !== null && Number.isFinite(speedKmh) ? `${Math.round(Math.max(0, speedKmh))} km/h` : '—'}</span>
      </div>
      <button className="btn stop nav-stop" onClick={onStop}>Stop</button>
    </div>
  );
}
