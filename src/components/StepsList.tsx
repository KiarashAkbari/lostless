import { useEffect, useRef } from 'react';
import type { RouteStep } from '../types';
import { maneuverGlyph, maneuverLabel } from '../lib/maneuvers';
import { formatDistance } from '../lib/geo';

interface StepsListProps {
  steps: RouteStep[];
  current: number | null;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function StepsList({ steps, current }: StepsListProps) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} ref={i === current ? currentRef : undefined} className={i === current ? 'current' : ''}>
          <span className="s-glyph" aria-hidden>{maneuverGlyph(s)}</span>
          <span className="s-body">
            <span className="s-instr">{s.instruction || cap(maneuverLabel(s))}</span>
            <span className="s-meta">
              {s.street ? `${s.street} · ` : ''}
              <span className="mono">{formatDistance(s.distanceM)}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
