/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lostless · guidance engine
 * ─────────────────────────────────────────────────────────────────────────────
 *  Pure math for the things that make a navigator feel competent. No React, no
 *  DOM — everything here is unit-tested.
 *
 *  Voice prompt timing follows OsmAnd's published trigger table (lead *time*
 *  converted to a distance at your speed, floored so a slow car still hears the
 *  prompt in time):
 *
 *    · "in 400 m"       → ~22 s lead, never later than 15 s before the turn
 *    · "prepare to…"    → ~115 s lead (motorway junctions need long warning)
 *    · "turn now"       → ~6.7 s lead, floored at 12 m
 *    · arrival          → ~5 s lead
 *
 *  Camera zoom follows speed with hysteresis, which is what Google Maps and
 *  Waze do: closer at town speeds, pulled back on the motorway so you can see
 *  the next junction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type PromptPhase = 'alert' | 'pre' | 'now' | 'arrive';

export interface Prompt {
  phase: PromptPhase;
  /** distance-to-maneuver at which this prompt is due */
  atM: number;
}

/** lead distance for a given lead time, floored so GPS error can't eat the prompt */
export const leadDistance = (speedMps: number, leadSeconds: number, floorM = 12): number =>
  Math.max(floorM, Math.max(0, Number.isFinite(speedMps) ? speedMps : 0) * leadSeconds);

/**
 * The prompt ladder for one maneuver at your current speed.
 * `approachM` is the length of the current leg: a 900 m "prepare to turn"
 * prompt is only worth having when there is actually 900 m of road to warn
 * you across, otherwise a city block would open with a motorway-style alert.
 */
export function promptLadder(approachM: number, speedMps: number): Prompt[] {
  // standstill: fall back to town-speed timings so a stationary phone still guides
  const v = Number.isFinite(speedMps) && speedMps > 0.5 ? speedMps : 8;
  const alert = leadDistance(v, 22, 90); // "in 400 m, turn right"
  const prepare = leadDistance(v, 115, 300); // "prepare to turn" (motorway)
  const now = leadDistance(v, 6.7); // "turn now"

  const out: Prompt[] = [];
  const approach = Number.isFinite(approachM) ? approachM : 0;
  if (approach >= prepare) out.push({ phase: 'alert', atM: prepare });
  out.push({ phase: 'pre', atM: alert });
  out.push({ phase: 'now', atM: now });
  return out;
}

/**
 * Which prompts are due, given the distance to the maneuver and which phases
 * have already been spoken for it. Closest-first, at most two at once (a slow
 * fix stream can otherwise fire three prompts in a row and sound manic).
 */
export function duePhases(
  distToM: number,
  speedMps: number,
  spoken: ReadonlySet<PromptPhase>,
  terminal = false,
): PromptPhase[] {
  if (!Number.isFinite(distToM) || distToM < 0) return [];
  if (terminal) {
    const atM = leadDistance(Number.isFinite(speedMps) && speedMps > 0.5 ? speedMps : 8, 5, 25);
    return distToM <= atM && !spoken.has('arrive') ? ['arrive'] : [];
  }

  const ladder = promptLadder(distToM, speedMps);
  const due = ladder.filter((p) => !spoken.has(p.phase) && distToM <= p.atM);
  if (!due.length) return [];
  // exactly one prompt per update, and always the most urgent one: firing
  // "in 400 m" and "turn now" together sounds like a broken radio
  due.sort((a, b) => a.atM - b.atM);
  return [due[0].phase];
}

/**
 * Spoken text for a phase. Prefers the router's own phrasing (Valhalla writes a
 * dedicated sentence for each moment of the approach) and falls back to a
 * natural sentence built from the maneuver label.
 */
export function promptText(
  phase: PromptPhase,
  step: { verbal?: string; verbalAlert?: string; verbalPost?: string; instruction: string; street?: string },
  fallbackLabel: string,
  distanceText: string,
): string {
  const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();
  const name = clean(step.verbal) || clean(step.instruction) || fallbackLabel;
  const target = step.street ? ` onto ${step.street}` : '';

  switch (phase) {
    case 'alert': {
      const own = clean(step.verbalAlert);
      // Valhalla's alert already reads "In 400 meters, turn right…" — drop its
      // distance and state the real one, otherwise the sentence stutters
      const body = own.replace(/^in\s+[^,]*,\s*/i, '');
      if (body) return `In ${distanceText}, ${lower(body)}`;
      return `In ${distanceText}, ${lower(name)}${target && !name.toLowerCase().includes(step.street!.toLowerCase()) ? target : ''}`;
    }
    case 'pre':
      return name;
    case 'now':
      return name;
    case 'arrive':
      return clean(step.verbal) || 'You have arrived at your destination.';
  }
}

const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** arriving: within this distance of the end, the last step is the arrival */
export function isAtDestination(remainingM: number): boolean {
  return Number.isFinite(remainingM) && remainingM <= 25;
}

/**
 * Speed-based navigation zoom with hysteresis. 18 in town, 17 on the open road,
 * 16 once you are really moving — the driver should see further ahead the
 * faster they travel. The 2 km/h dead band stops it flickering at a threshold.
 */
const ZOOM_LEVELS = [18, 17.5, 16.5, 15.5] as const;
/** zone boundaries, km/h: town → open road → fast → motorway */
const ZOOM_THRESHOLDS = [30, 62, 95] as const;
const HYSTERESIS_KMH = 3;

export function navZoomForSpeed(speedKmh: number, currentZoom = 18): number {
  const v = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  let zone = Math.max(0, ZOOM_LEVELS.indexOf(currentZoom as (typeof ZOOM_LEVELS)[number]));
  // walk up only when clearly above the next threshold, down only when clearly
  // below the current one — holding 61 km/h keeps whichever zoom you had
  while (zone < ZOOM_LEVELS.length - 1 && v > ZOOM_THRESHOLDS[zone] + HYSTERESIS_KMH) zone += 1;
  while (zone > 0 && v < ZOOM_THRESHOLDS[zone - 1] - HYSTERESIS_KMH) zone -= 1;
  return ZOOM_LEVELS[zone];
}

/**
 * Heading for the camera and the arrow, in priority order:
 *   1. GPS course — only trustworthy while actually moving (≥ 2.5 m/s)
 *   2. the bearing of the route ahead (steady in traffic jams and tunnels)
 *   3. the direction of the last few metres of movement
 *   4. whatever we were showing before
 */
export function pickHeading(input: {
  course: number | null | undefined;
  speedMps: number | null | undefined;
  routeBearing: number | null | undefined;
  moveBearing: number | null | undefined;
  fallback: number;
}): number {
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  const speed = ok(input.speedMps) ? input.speedMps : 0;
  if (ok(input.course) && speed >= 2.5) return norm(input.course);
  if (ok(input.routeBearing)) return norm(input.routeBearing);
  if (ok(input.moveBearing)) return norm(input.moveBearing);
  return norm(input.fallback);
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** ETA in seconds using live speed when it is meaningfully different from the plan */
export function liveRemainingSeconds(plannedS: number, remainingM: number, speedMps: number): number {
  const planned = Number.isFinite(plannedS) ? Math.max(0, plannedS) : 0;
  const v = Number.isFinite(speedMps) ? speedMps : 0;
  if (v < 2 || remainingM <= 0) return planned;
  const live = remainingM / v;
  // blend, don't whipsaw: traffic lights and a single fast fix shouldn't move the clock
  return Math.round(planned * 0.6 + live * 0.4);
}

/**
 * Zoom while driving: the speed zones above, plus a pull-in on the approach to
 * a maneuver so the junction is legible. That is exactly the dance Google and
 * Waze do — wide on the straight, tight at the turn — and it is clamped so the
 * camera never lurches.
 */
export function navZoomTarget(speedKmh: number, currentZoom: number, distToNextM: number): number {
  const base = navZoomForSpeed(speedKmh, currentZoom);
  const d = Number.isFinite(distToNextM) ? distToNextM : Infinity;
  // below ~20 m the turn is already on screen; zooming further just hides the road after it
  const boost = d > 20 && d < 160 ? 0.75 : 0;
  return Math.max(15, Math.min(18.5, base + boost));
}

/**
 * Bearing of the road `meters` ahead along a polyline — the camera's heading
 * when the GPS course is unavailable (stopped at a light, tunnel, first fix).
 */
export function bearingAhead(coords: [number, number][], meters: number, startIndex = 0): number | null {
  if (!coords?.length) return null;
  const i0 = Math.min(Math.max(0, startIndex), coords.length - 1);
  const a = coords[i0];
  if (!a || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) return null;
  const want = Number.isFinite(meters) && meters > 0 ? meters : 40;
  let acc = 0;
  let last: number | null = null;
  for (let i = i0 + 1; i < coords.length; i++) {
    const p = coords[i - 1];
    const q = coords[i];
    if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
    const dy = (q[1] - p[1]) * 110540;
    const dx = (q[0] - p[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180);
    const seg = Math.hypot(dx, dy);
    if (seg < 0.5) continue; // duplicate vertices carry no direction
    acc += seg;
    last = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360; // 0 = north, clockwise
    if (acc >= want) return last;
  }
  // a route shorter than `meters`: the final direction still beats giving up
  return last;
}

/**
 * Is the driver over the posted limit? The tolerance mirrors what sat-navs
 * use: a few km/h of GPS/rounding slack, then a proportional allowance.
 */
export function overSpeedLimit(speedKmh: number, limitKmh: number | null | undefined): boolean {
  if (limitKmh === null || limitKmh === undefined || !Number.isFinite(limitKmh) || limitKmh <= 0) return false;
  if (!Number.isFinite(speedKmh)) return false;
  const slack = Math.max(5, limitKmh * 0.1);
  return speedKmh > limitKmh + slack;
}
