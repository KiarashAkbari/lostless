import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CONFIG } from '../config';
import { getRoute } from './routing';

/**
 * What the router tells us beyond a line on the map: staged voice phrasing,
 * lanes, exit numbers, posted limits, toll/highway flags, and the costing
 * options that make "avoid tolls" mean something. All of it is parsed from
 * Valhalla; a field that is missing must simply stay absent, never NaN/''.
 */

const SHAPE = '_ibE_SeK_??_'; // two valid points near Frankfurt

const maneuver = (over: Record<string, unknown> = {}) => ({
  instruction: 'Turn right onto Main Street',
  street_names: ['Main Street'],
  length: 0.4,
  time: 60,
  type: 2,
  modifier: 'right',
  begin_shape_index: 0,
  verbal_transition_alert_instruction: 'In 400 meters, turn right onto Main Street.',
  verbal_pre_transition_instruction: 'Turn right onto Main Street.',
  verbal_post_transition_instruction: 'Continue on Main Street for 400 meters.',
  ...over,
});

function mockRoute(maneuvers: unknown[], extra: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      trip: { summary: { length: 1.2, time: 180 }, legs: [{ shape: SHAPE, maneuvers }] },
      ...extra,
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** the JSON that was actually posted to the router */
function sentPayload(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const url = String(fetchMock.mock.calls[call][0]);
  const q = url.slice(url.indexOf('?json=') + 6);
  return JSON.parse(decodeURIComponent(q)) as Record<string, unknown>;
}

beforeEach(() => {
  (CONFIG.routing as { minIntervalMs: number }).minIntervalMs = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('valhalla maneuver enrichment', () => {
  it('keeps all three verbal stages and the multi-cue flag', async () => {
    mockRoute([maneuver({ verbal_multi_cue: true })]);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    const s = r.steps[0];
    expect(s.verbal).toBe('Turn right onto Main Street.');
    expect(s.verbalAlert).toBe('In 400 meters, turn right onto Main Street.');
    expect(s.verbalPost).toBe('Continue on Main Street for 400 meters.');
    expect(s.multiCue).toBe(true);
  });

  it('parses lanes with their active flag and drops empty entries', async () => {
    mockRoute([
      maneuver({
        lanes: [
          { directions: ['left'], active: false },
          { directions: ['straight', 'right'], active: true },
          { directions: [], active: true },
          { directions: ['u_turn'], active: false },
        ],
      }),
    ]);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    expect(r.steps[0].lanes).toEqual([
      { directions: ['left'], active: false },
      { directions: ['straight', 'right'], active: true },
      { directions: ['u_turn'], active: false },
    ]);
  });

  it('reads an exit number from either sign shape', async () => {
    mockRoute([
      maneuver({ type: 13, sign: { exit_number_elements: [{ text: '42', is_route_number: false }] } }),
      maneuver({ type: 13, sign: { exit_numbers: [{ text: 'A' }, { text: '661' }] } }),
      maneuver({ type: 13, sign: { exit_numbers: '9B' } }),
      maneuver({ type: 13, sign: { elements: [{ text: 'nope' }] } }),
    ]);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    expect(r.steps[0].exitNumber).toBe('42');
    expect(r.steps[1].exitNumber).toBe('A 661');
    expect(r.steps[2].exitNumber).toBe('9B');
    expect(r.steps[3].exitNumber).toBeUndefined();
  });

  it('carries posted limits, toll and highway flags', async () => {
    mockRoute([
      maneuver({ speed_limit: 100, toll: true, highway: true }),
      maneuver({ speed_limit: 0 }),
      maneuver({ type: 9 }), // ferry
    ]);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    expect(r.steps[0].speedLimit).toBe(100);
    expect(r.steps[0].toll).toBe(true);
    expect(r.steps[0].highway).toBe(true);
    expect(r.steps[1].speedLimit).toBeUndefined(); // 0 means "unknown"
    expect(r.hasToll).toBe(true);
    expect(r.hasHighway).toBe(true);
    expect(r.hasFerry).toBe(true);
  });

  it('omits optional fields entirely when the router is silent', async () => {
    mockRoute([maneuver({ verbal_transition_alert_instruction: '', lanes: [], speed_limit: undefined })]);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    const s = r.steps[0];
    expect(s.verbalAlert).toBeUndefined();
    expect(s.lanes).toBeUndefined();
    expect(s.speedLimit).toBeUndefined();
    expect(r.hasToll).toBeUndefined();
    expect(r.hasFerry).toBeUndefined();
  });

  it('strips HTML from the verbal sentences too', async () => {
    mockRoute([maneuver({ verbal_pre_transition_instruction: 'Turn right onto <b>Main</b> St' })]);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12]);
    expect(r.steps[0].verbal).toBe('Turn right onto Main St');
  });
});

describe('avoid preferences reach the router as costing options', () => {
  it('sends use_tolls/use_highways/use_ferry for a car', async () => {
    const f = mockRoute([maneuver()]);
    await getRoute('car', [8.68, 50.11], [8.69, 50.12], { tolls: true, highways: true, ferries: true });
    expect(sentPayload(f).costing_options).toEqual({
      auto: { use_tolls: 0, use_highways: 0, use_ferry: 0 },
    });
  });

  it('only sends what is asked for, and nothing when everything is off', async () => {
    const f = mockRoute([maneuver()]);
    await getRoute('car', [8.68, 50.11], [8.69, 50.12], { tolls: false, highways: true, ferries: false });
    expect(sentPayload(f, 0).costing_options).toEqual({ auto: { use_highways: 0 } });

    await getRoute('car', [8.68, 50.11], [8.69, 50.12], { tolls: false, highways: false, ferries: false });
    expect(sentPayload(f, 1).costing_options).toBeUndefined();
  });

  it('does not pretend a bike can avoid motorways it may not use, but does avoid ferries', async () => {
    const f = mockRoute([maneuver()]);
    await getRoute('bike', [8.68, 50.11], [8.69, 50.12], { tolls: true, highways: true, ferries: true });
    const opts = sentPayload(f).costing_options as Record<string, Record<string, unknown>>;
    expect(opts.bicycle).toEqual({ use_ferry: 0 });
  });

  it('falls back to a plain request when the host rejects the options', async () => {
    let call = 0;
    const f = vi.fn(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 400, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ trip: { summary: { length: 1, time: 60 }, legs: [{ shape: SHAPE, maneuvers: [maneuver()] }] } }),
      };
    });
    vi.stubGlobal('fetch', f);
    const r = await getRoute('car', [8.68, 50.11], [8.69, 50.12], { tolls: true, highways: false, ferries: false });
    expect(r.steps.length).toBe(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(sentPayload(f, 1).costing_options).toBeUndefined();
  });
});

/** tiny polyline6 encoder, so the waypoint test can build a real two-leg trip */
function encode(coords: Array<[number, number]>): string {
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lon * 1e6);
    out += enc(la - prevLat) + enc(lo - prevLon);
    prevLat = la;
    prevLon = lo;
  }
  return out;
}

describe('waypoints (multi-leg trips)', () => {
  const A: [number, number] = [8.68, 50.11];
  const B: [number, number] = [8.69, 50.115];
  const C: [number, number] = [8.7, 50.12];

  function mockTwoLegs() {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        trip: {
          summary: { length: 3, time: 600 },
          legs: [
            {
              shape: encode([A, B]),
              maneuvers: [
                maneuver({ instruction: 'Drive to stop', type: 0, begin_shape_index: 0 }),
                maneuver({ instruction: 'You have arrived at your destination.', type: 1, begin_shape_index: 1, verbal_pre_transition_instruction: 'You have arrived.' }),
              ],
            },
            {
              // arrives on the same point leg one ended on
              shape: encode([B, C]),
              maneuvers: [
                maneuver({ instruction: 'Head on', type: 0, begin_shape_index: 0 }),
                maneuver({ instruction: 'You have arrived at your destination.', type: 1, begin_shape_index: 1 }),
              ],
            },
          ],
        },
      }),
    }));
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('sends the stops as ordered break locations', async () => {
    const f = mockTwoLegs();
    await getRoute('car', [8.6, 50.1], C, undefined, [A, B]);
    const locs = sentPayload(f).locations as Array<{ lat: number; lon: number; type?: string }>;
    expect(locs).toHaveLength(4);
    expect(locs[0]).toEqual({ lat: 50.1, lon: 8.6 });
    expect(locs[1]).toMatchObject({ lat: 50.11, lon: 8.68, type: 'break' });
    expect(locs[2]).toMatchObject({ lat: 50.115, lon: 8.69, type: 'break' });
    expect(locs[3]).toEqual({ lat: 50.12, lon: 8.7 });
  });

  it('stitches the leg shapes into one line without duplicating the join', async () => {
    mockTwoLegs();
    const r = await getRoute('car', [8.6, 50.1], C, undefined, [A]);
    expect(r.coords).toEqual([A, B, C]);
    expect(r.distanceM).toBe(3000);
  });

  it('turns the intermediate arrival into a stop, keeping the final one', async () => {
    mockTwoLegs();
    const r = await getRoute('car', [8.6, 50.1], C, undefined, [A]);
    expect(r.steps).toHaveLength(4);
    expect(r.steps[1].instruction).toBe('Stop 1');
    expect(r.steps[1].verbal).toBe('You have reached stop 1.');
    expect(r.steps[3].type).toBe('arrive');
    // every step still points at a real vertex of the stitched line
    for (const s of r.steps) expect(r.coords).toContainEqual(s.location);
  });
});
