/** Small geo helpers. All coordinates are [lon, lat] unless noted. */

const R = 6371000; // earth radius, meters
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: [number, number], b: [number, number]): number {
  if (!a || !b || !Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) return Infinity;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** finite number or fallback — kills NaN/Infinity from flaky sensors & APIs */
export const finite = (v: number | null | undefined, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** distance from point p to segment a–b, in meters (equirectangular approx — fine at city scale) */
function pointToSegmentM(p: [number, number], a: [number, number], b: [number, number]): { d: number; t: number } {
  const lat = toRad(p[1]);
  const kx = Math.cos(lat) * 111320; // meters per degree lon at this latitude
  const ky = 110540; // meters per degree lat
  const px = p[0] * kx, py = p[1] * ky;
  const ax = a[0] * kx, ay = a[1] * ky;
  const bx = b[0] * kx, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d: Math.hypot(px - cx, py - cy), t };
}

export interface NearestOnLine {
  /** distance from p to the polyline, meters */
  distM: number;
  /** arclength along the polyline of the nearest point, meters */
  arclengthM: number;
  /** index of the segment the nearest point lies on */
  segmentIndex: number;
  /** the nearest point itself, [lon, lat] */
  point: [number, number];
}

/** nearest point on a polyline to p, plus its arclength from the start.
 *  Safe against empty/degenerate polylines and non-finite input. */
export function nearestOnPolyline(coords: [number, number][], p: [number, number]): NearestOnLine {
  if (coords.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
    return { distM: Infinity, arclengthM: 0, segmentIndex: 0, point: [finite(p[0], 0), finite(p[1], 0)] };
  }
  let best = { d: Infinity, t: 0, index: 0 };
  let arclength = 0;
  let bestArclength = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b || !Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
    const segLen = haversineM(a, b);
    const { d, t } = pointToSegmentM(p, a, b);
    if (d < best.d) {
      best = { d, t, index: i };
      bestArclength = arclength + segLen * t;
    }
    arclength += segLen;
  }
  const a = coords[best.index];
  const b = coords[best.index + 1];
  let point: [number, number];
  if (a && Number.isFinite(a[0]) && Number.isFinite(a[1])) {
    if (b && Number.isFinite(b[0]) && Number.isFinite(b[1]) && best.d < Infinity) {
      point = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
    } else {
      point = [a[0], a[1]];
    }
  } else {
    point = [finite(p[0], 0), finite(p[1], 0)];
  }
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) point = [finite(p[0], 0), finite(p[1], 0)];
  return { distM: best.d, arclengthM: bestArclength, segmentIndex: best.index, point };
}

/** "850 m" / "12.4 km" / "—" for garbage */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** "12 min" / "1 h 05 min" / "—" for garbage */
export function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}

/** wall-clock ETA, e.g. "14:32" / "--:--" for garbage */
export function formatEta(durationS: number, now = Date.now()): string {
  if (!Number.isFinite(durationS) || durationS < 0) return '--:--';
  const d = new Date(now + durationS * 1000);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatCoord(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}°${ns} ${Math.abs(lon).toFixed(5)}°${ew}`;
}

/** approximate circle polygon around center (for the GPS accuracy bubble), [lon, lat][] ring.
 *  NaN-safe: a garbage radius becomes a sane default, a garbage center becomes [0,0]. */
export function circlePolygon(center: [number, number], radiusM: number, n = 40): [number, number][] {
  const lon = finite(center?.[0], 0);
  const lat = finite(center?.[1], 0);
  const r = Number.isFinite(radiusM) && radiusM > 0 ? Math.min(radiusM, 50000) : 25; // clamp: 25 m default, max 50 km
  const latM = 110540;
  const lonM = Math.max(111320 * Math.cos((lat * Math.PI) / 180), 1); // avoid div-by-0 at the poles
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([lon + (Math.cos(a) * r) / lonM, lat + (Math.sin(a) * r) / latM]);
  }
  ring.push(ring[0]);
  return ring;
}

/** decode Google/Valhalla polyline (precision 1e6 → [lon, lat][]).
 *  Never returns non-finite coordinates — a corrupt shape yields fewer points, not NaN. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coords: [number, number][] = [];
  if (typeof str !== 'string' || !str) return coords;
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let result = 0, shift = 0, byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    const lo = lng / factor;
    const la = lat / factor;
    if (Number.isFinite(lo) && Number.isFinite(la)) coords.push([lo, la]);
  }
  return coords;
}
