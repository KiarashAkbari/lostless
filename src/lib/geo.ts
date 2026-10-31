/** Small geo helpers. All coordinates are [lon, lat] unless noted. */

const R = 6371000; // earth radius, meters
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

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

/** nearest point on a polyline to p, plus its arclength from the start */
export function nearestOnPolyline(coords: [number, number][], p: [number, number]): NearestOnLine {
  let best = { d: Infinity, t: 0, index: 0 };
  let arclength = 0;
  let bestArclength = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const segLen = haversineM(coords[i], coords[i + 1]);
    const { d, t } = pointToSegmentM(p, coords[i], coords[i + 1]);
    if (d < best.d) {
      best = { d, t, index: i };
      bestArclength = arclength + segLen * t;
    }
    arclength += segLen;
  }
  const a = coords[best.index];
  const b = coords[best.index + 1] ?? a;
  const point: [number, number] = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
  return { distM: best.d, arclengthM: bestArclength, segmentIndex: best.index, point };
}

/** "850 m" / "12.4 km" */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** "12 min" / "1 h 05 min" */
export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}

/** wall-clock ETA, e.g. "14:32" */
export function formatEta(durationS: number, now = Date.now()): string {
  const d = new Date(now + durationS * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}°${ns} ${Math.abs(lon).toFixed(5)}°${ew}`;
}

/** decode Google/Valhalla polyline (precision 1e6 → [lon, lat][]) */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coords: [number, number][] = [];
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
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}
