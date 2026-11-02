import { useLayoutEffect, useRef } from 'react';
import type { TravelMode } from '../config';
import type { RouteStep } from '../types';
import { laneGlyph, maneuverGlyph, maneuverLabel } from '../lib/maneuvers';
import { formatDistance, formatDuration, formatEta } from '../lib/geo';
import { isAtDestination, overSpeedLimit } from '../lib/guidance';

interface NavOverlayProps {
  step: RouteStep | undefined;
  /** the maneuver after this one — announced early when they are close together */
  nextStep?: RouteStep;
  distToNextM: number;
  remainingM: number;
  /** ETA already adjusted for live speed (lib/guidance.liveRemainingSeconds) */
  remainingS: number;
  speedKmh: number | null;
  /** posted limit of the road ahead, km/h */
  speedLimit?: number;
  /** 0..1 fraction of the route already covered */
  progress: number;
  mode: TravelMode;
  onStop: () => void;
}

const MODE_LABEL: Record<TravelMode, string> = { car: 'Drive', walk: 'Walk', bike: 'Bike' };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Navigation mode readout (sat-nav style): a big next-turn card on top with
 * lane guidance, motorway exit numbers and the posted limit, then route
 * progress and an ETA / speed strip with a stop button. Numbers are the only
 * monospace text here.
 */
export function NavOverlay({
  step,
  nextStep,
  distToNextM,
  remainingM,
  remainingS,
  speedKmh,
  speedLimit,
  progress,
  mode,
  onStop,
}: NavOverlayProps) {
  // publish our height so banners can sit *below* this card instead of on it
  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--nav-h', `${el.offsetHeight}px`);
    sync();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.setProperty('--nav-h', '0px');
    };
  }, []);

  // a route with zero steps still needs the overlay (stop button, ETA) — show a fallback card
  const arrived = isAtDestination(remainingM);
  const glyph = arrived ? '◉' : step ? maneuverGlyph(step) : '◦';
  const label = arrived ? "You've arrived" : step ? cap(maneuverLabel(step)) : 'On your way';
  const street = step ? step.street || step.instruction : '';
  const lanes = !arrived ? step?.lanes : undefined;
  const exit = !arrived ? step?.exitNumber : undefined;
  const limit = !arrived ? (step?.speedLimit ?? speedLimit) : undefined;
  const over = limit !== undefined && speedKmh !== null && overSpeedLimit(speedKmh, limit);
  // "then turn right" only when the two maneuvers really are back to back
  const then = !arrived && nextStep && nextStep.type !== 'arrive' && distToNextM < 400 ? nextStep : undefined;

  return (
    <div className="nav-overlay" ref={cardRef}>
      <div className="nav-main">
        <span className="nav-glyph" aria-hidden>{glyph}</span>
        <div className="nav-text">
          <div className="nav-in">
            {arrived ? label : (<><span className="mono nav-dist">{formatDistance(distToNextM)}</span> {label}</>)}
            {exit && <span className="nav-exit">Exit <span className="mono">{exit}</span></span>}
          </div>
          <div className="nav-street">{street}</div>
          {then && (
            <div className="nav-then">
              then <span aria-hidden>{maneuverGlyph(then)}</span> {maneuverLabel(then)}
              {then.exitNumber ? ` · exit ${then.exitNumber}` : ''}
            </div>
          )}
        </div>
        {limit !== undefined && (
          <span
            className={`nav-limit${over ? ' over' : ''}`}
            title={`Speed limit ${limit} km/h`}
            aria-label={`Speed limit ${limit} kilometres per hour`}
          >
            <span className="mono">{limit}</span>
          </span>
        )}
        <span className="chip nav-mode">{MODE_LABEL[mode]}</span>
      </div>

      {lanes && lanes.length > 0 && (
        <div className="nav-lanes" aria-label="Lanes for the next turn">
          {lanes.map((l, i) => (
            <span key={i} className={`lane${l.active ? ' on' : ''}`}>
              {l.directions.map((d) => (
                <span key={d} className="lane-g" aria-hidden title={d}>{laneGlyph(d)}</span>
              ))}
            </span>
          ))}
        </div>
      )}

      <div className="nav-progress" aria-hidden>
        <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
      </div>
      <div className="nav-sub">
        <span>Arrive <span className="mono">{formatEta(remainingS)}</span></span>
        <span className="mono">{formatDuration(remainingS)}</span>
        <span><span className="mono">{formatDistance(remainingM)}</span> to go</span>
        <span className="mono">{speedKmh !== null && Number.isFinite(speedKmh) ? `${Math.round(Math.max(0, speedKmh))} km/h` : '—'}</span>
      </div>
      <button className="btn stop nav-stop" onClick={onStop}>Stop</button>
    </div>
  );
}
