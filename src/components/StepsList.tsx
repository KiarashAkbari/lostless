import { useEffect, useRef } from 'react';
import type { RouteStep } from '../types';
import { maneuverGlyph, maneuverLabel } from '../lib/maneuvers';
import { formatDistance } from '../lib/geo';

interface StepsListProps {
  steps: RouteStep[];
  current: number | null;
}

export function StepsList({ steps, current }: StepsListProps) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} ref={i === current ? currentRef : undefined} className={i === current ? 'current' : ''}>
          <span className="s-glyph mono" aria-hidden>{maneuverGlyph(s)}</span>
          <span className="s-body">
            <span className="s-instr">{s.instruction || maneuverLabel(s)}</span>
            <span className="s-meta mono">
              {[s.street, formatDistance(s.distanceM)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
