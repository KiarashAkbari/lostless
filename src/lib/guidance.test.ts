import { describe, it, expect } from 'vitest';
import {
  leadDistance,
  promptLadder,
  duePhases,
  promptText,
  isAtDestination,
  navZoomForSpeed,
  pickHeading,
  liveRemainingSeconds,
  navZoomTarget,
  bearingAhead,
  overSpeedLimit,
} from './guidance';

describe('prompt timing (OsmAnd-inspired lead times)', () => {
  it('scales the lead distance with speed, with a floor', () => {
    expect(leadDistance(20, 22)).toBe(440); // ~72 km/h → 22 s ahead
    expect(leadDistance(0, 22, 90)).toBe(90); // standstill never below the floor
    expect(leadDistance(0.2, 6.7)).toBe(12); // 12 m floor for GPS error
  });

  it('only offers the long "prepare" prompt when the approach is long', () => {
    const town = promptLadder(200, 8).map((p) => p.phase);
    const motorway = promptLadder(4000, 30).map((p) => p.phase);
    expect(town).toEqual(['pre', 'now']);
    expect(motorway).toEqual(['alert', 'pre', 'now']);
  });

  it('fires each prompt once, closest-first', () => {
    // 20 m out at 40 km/h: "turn now" only
    const spoken = new Set<'alert' | 'pre' | 'now' | 'arrive'>();
    expect(duePhases(20, 11, spoken)).toEqual(['now']);

    // 300 m out at 50 km/h: the approach prompt is due
    expect(duePhases(300, 14, spoken)).toEqual(['pre']);

    // already spoken → nothing repeats
    expect(duePhases(300, 14, new Set(['pre']))).toEqual([]);
  });

  it('never stacks "turn now" behind a calmer prompt in the same update', () => {
    const due = duePhases(5, 14, new Set());
    expect(due).toEqual(['now']);
  });

  it('announces arrival once, near the end', () => {
    expect(duePhases(12, 5, new Set(), true)).toEqual(['arrive']);
    expect(duePhases(12, 5, new Set(['arrive']), true)).toEqual([]);
    expect(isAtDestination(18)).toBe(true);
    expect(isAtDestination(140)).toBe(false);
  });
});

describe('spoken text', () => {
  const step = {
    instruction: 'Turn right onto Oak Street.',
    verbal: 'Turn right onto Oak Street.',
    verbalAlert: 'In 400 meters, turn right onto Oak Street.',
    street: 'Oak Street',
  };

  it('uses the router phrasing and prepends the live distance', () => {
    expect(promptText('alert', step, 'Turn right', '300 m')).toBe('In 300 m, turn right onto Oak Street.');
    expect(promptText('pre', step, 'Turn right', '20 m')).toBe('Turn right onto Oak Street.');
  });

  it('falls back to the instruction when the router has no verbal text', () => {
    const bare = { instruction: 'Turn left onto Main Street.', street: 'Main Street' };
    expect(promptText('pre', bare, 'Turn left', '50 m')).toBe('Turn left onto Main Street.');
  });

  it('says something sensible for arrival', () => {
    expect(promptText('arrive', { instruction: '' }, 'Arrive', '0 m')).toBe('You have arrived at your destination.');
  });
});

describe('camera behaviour', () => {
  it('zooms out with speed and does not flicker at the boundary', () => {
    expect(navZoomForSpeed(0, 18)).toBe(18);
    expect(navZoomForSpeed(40, 18)).toBe(17.5);
    expect(navZoomForSpeed(70, 18)).toBe(16.5);
    expect(navZoomForSpeed(110, 17.5)).toBe(15.5);
    // dead band: 61 km/h keeps whichever zoom you already had
    expect(navZoomForSpeed(61, 17.5)).toBe(17.5);
    expect(navZoomForSpeed(61, 16.5)).toBe(16.5);
  });

  it('trusts the GPS course only while moving, then the route, then movement', () => {
    expect(pickHeading({ course: 90, speedMps: 10, routeBearing: 45, moveBearing: 20, fallback: 0 })).toBe(90);
    // crawling in traffic: use the road ahead, not a jittery compass
    expect(pickHeading({ course: 300, speedMps: 0.4, routeBearing: 45, moveBearing: 20, fallback: 0 })).toBe(45);
    expect(pickHeading({ course: null, speedMps: 9, routeBearing: null, moveBearing: 210, fallback: 0 })).toBe(210);
    expect(pickHeading({ course: NaN, speedMps: 9, routeBearing: undefined, moveBearing: null, fallback: 361 })).toBe(1);
  });

  it('blends live speed into the remaining time instead of whipsawing', () => {
    // 10 min planned, 6 km left, 20 m/s → live estimate 300 s, blended
    const eta = liveRemainingSeconds(600, 6000, 20);
    expect(eta).toBeGreaterThan(300);
    expect(eta).toBeLessThan(600);
    // standing still: keep the plan
    expect(liveRemainingSeconds(600, 6000, 0)).toBe(600);
  });
});

describe('navZoomTarget', () => {
  it('widens with speed and pulls in for a junction', () => {
    // crawling in town: closest view, and a turn ahead means no extra zoom
    expect(navZoomTarget(0, 18, 1000)).toBe(18);
    // 120 km/h on the motorway: wide, but the exit is 100 m away → pull in
    expect(navZoomTarget(120, 15.5, 1000)).toBe(15.5);
    expect(navZoomTarget(120, 15.5, 100)).toBe(16.25);
    // never beyond the clamp, even stacked on top of a town zoom
    expect(navZoomTarget(0, 18, 100)).toBe(18.5);
  });
  it('does not zoom in while sitting on the junction itself', () => {
    // 50 km/h already belongs to the open-road zone, and a turn 10 m away
    // must not tighten the view any further
    expect(navZoomTarget(50, 18, 10)).toBe(17.5);
    expect(navZoomTarget(50, 18, NaN)).toBe(17.5);
  });
});

describe('bearingAhead', () => {
  const north: [number, number][] = [[8.68, 50.1], [8.68, 50.101], [8.68, 50.102]];
  const east: [number, number][] = [[8.68, 50.1], [8.69, 50.1]];
  it('reads the direction of the road, not the map north', () => {
    expect(bearingAhead(north, 50)).toBeCloseTo(0, 0);
    expect(bearingAhead(east, 50)).toBeCloseTo(90, 0);
  });
  it('survives short, empty and broken polylines', () => {
    expect(bearingAhead([], 50)).toBeNull();
    expect(bearingAhead([[8.68, 50.1]], 50)).toBeNull();
    expect(bearingAhead([[8.68, 50.1], [NaN, NaN]], 50)).toBeNull();
    // a route shorter than the look-ahead still answers with its last leg
    expect(bearingAhead(north, 10_000)).toBeCloseTo(0, 0);
  });
});

describe('overSpeedLimit', () => {
  it('allows the same slack a sat-nav does', () => {
    expect(overSpeedLimit(55, 50)).toBe(false); // 5 km/h of slack
    expect(overSpeedLimit(56, 50)).toBe(true);
    expect(overSpeedLimit(108, 100)).toBe(false); // 10% of 100
    expect(overSpeedLimit(111, 100)).toBe(true);
    expect(overSpeedLimit(200, null)).toBe(false);
    expect(overSpeedLimit(200, 0)).toBe(false);
    expect(overSpeedLimit(NaN, 50)).toBe(false);
  });
});
