import type { RouteStep } from '../types';
import { maneuverGlyph, maneuverLabel } from '../lib/maneuvers';
import { formatDistance, formatDuration, formatEta } from '../lib/geo';

interface NavOverlayProps {
  step: RouteStep | undefined;
  distToNextM: number;
  remainingM: number;
  remainingS: number;
}

/** Big "next maneuver" readout while navigating. */
export function NavOverlay({ step, distToNextM, remainingM, remainingS }: NavOverlayProps) {
  if (!step) return null;
  return (
    <div className="nav-overlay">
      <div className="nav-main">
        <span className="nav-glyph mono" aria-hidden>{maneuverGlyph(step)}</span>
        <div className="nav-text">
          <div className="nav-in">
            IN {formatDistance(distToNextM)} — {maneuverLabel(step).toUpperCase()}
          </div>
          <div className="nav-street mono">{step.street || step.instruction}</div>
        </div>
      </div>
      <div className="nav-sub mono">
        ETA // {formatEta(remainingS)} · {formatDuration(remainingS)} · {formatDistance(remainingM)} LEFT
      </div>
    </div>
  );
}
