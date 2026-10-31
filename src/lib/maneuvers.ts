import type { RouteStep } from '../types';

/**
 * Turn-by-turn glyphs. Plain unicode arrows (not emoji) keep the hacker vibe.
 * Works for both Valhalla and OSRM type vocabularies.
 */
export function maneuverGlyph(step: Pick<RouteStep, 'type' | 'modifier'>): string {
  const t = step.type.toLowerCase();
  const m = (step.modifier ?? '').toLowerCase();
  if (t === 'arrive') return '◉';
  if (t === 'depart') return '◦';
  if (t.includes('roundabout') || t.includes('rotary')) {
    if (t.startsWith('exit')) return '↻';
    return '↻';
  }
  if (t === 'merge') return m.includes('left') ? '⬈' : '⬉';
  if (t === 'fork') return m.includes('left') ? '⬉' : '⬈';
  if (t === 'off ramp' || t === 'exit') return '⤴';
  if (t === 'on ramp') return '⤵';
  if (t === 'ferry') return '≋';
  if (t === 'turn' || t === 'end of road' || t === 'new name' || t === 'continue' || t === 'notification') {
    if (m.includes('left')) return t === 'turn' ? '←' : '⬅';
    if (m.includes('right')) return t === 'turn' ? '→' : '➡';
    if (m.includes('uturn')) return '↺';
    if (m.includes('straight')) return '↑';
    return '↑';
  }
  return '↑';
}

/** short imperative label, e.g. "turn left", "roundabout — exit 2" */
export function maneuverLabel(step: Pick<RouteStep, 'type' | 'modifier'>): string {
  const t = step.type.toLowerCase();
  const m = (step.modifier ?? '').toLowerCase();
  if (t === 'arrive') return 'arrive';
  if (t === 'depart') return 'depart';
  if (t.includes('roundabout') || t.includes('rotary')) return t.startsWith('exit') ? 'exit roundabout' : 'roundabout';
  if (t === 'merge') return `merge ${m}`.trim();
  if (t === 'fork') return `keep ${m || 'straight'}`;
  if (t === 'off ramp' || t === 'exit') return `take exit ${m}`.trim();
  if (t === 'on ramp') return 'take ramp';
  if (t === 'ferry') return 'take ferry';
  if (t === 'new name') return 'road changes name';
  if (t === 'turn') return `turn ${m || 'straight'}`.trim();
  return m ? `${t} ${m}`.trim() : t;
}
