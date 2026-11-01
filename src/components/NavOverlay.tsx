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

const MODE_LABEL: Record<TravelMode, string> = { car: 'DRIVE', walk: 'WALK', bike: 'BIKE' };

/**
 * Navigation mode readout (Neshan/Balad-style): a big next-turn card on top,
 * route progress bar, and an ETA / speed strip with a STOP button.
 */
export function NavOverlay({ step, distToNextM, remainingM, remainingS, speedKmh, progress, mode, onStop }: NavOverlayProps) {
  if (!step) return null;
  return (
    <div className="nav-overlay">
      <div className="nav-main">
        <span className="nav-glyph" aria-hidden>{maneuverGlyph(step)}</span>
        <div className="nav-text">
          <div className="nav-in">
            <span className="mono nav-dist">{formatDistance(distToNextM)}</span> {maneuverLabel(step).toUpperCase()}
          </div>
          <div className="nav-street mono">{step.street || step.instruction}</div>
        </div>
        <span className="chip mono nav-mode">{MODE_LABEL[mode]}</span>
      </div>
      <div className="nav-progress" aria-hidden>
        <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
      </div>
      <div className="nav-sub mono">
        <span>ARRIVE {formatEta(remainingS)}</span>
        <span>{formatDuration(remainingS)}</span>
        <span>{formatDistance(remainingM)} LEFT</span>
        <span>{speedKmh !== null && Number.isFinite(speedKmh) ? `${Math.round(Math.max(0, speedKmh))} KM/H` : '—'}</span>
      </div>
      <button className="btn stop nav-stop mono" onClick={onStop}>■ STOP</button>
    </div>
  );
}
