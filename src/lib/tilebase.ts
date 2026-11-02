/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lostless · where do the tiles come from?
 * ─────────────────────────────────────────────────────────────────────────────
 *  The browser downloads the tiles, so the direct CDN URL is always preferred:
 *  fewer hops, HTTP/2, the host's own caching. The same-origin /proxy/* path
 *  only exists because the Arena preview sandbox can be sealed off from
 *  third-party hosts — and when it is, every proxied request fails and the map
 *  renders as a flat colour.
 *
 *  So: probe both (direct first, with a short budget) and use whichever answers
 *  first. Decided once per session, then cached.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CONFIG, proxyUrl } from '../config';
import type { TileBase } from './mapStyle';

export interface TileJson {
  tiles?: string[];
  minzoom?: number;
  maxzoom?: number;
}

/** fetch + parse JSON with a hard deadline; throws on any problem */
export async function fetchJsonWithTimeout(url: string, ms: number): Promise<TileJson> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl?.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as TileJson;
  } finally {
    clearTimeout(timer);
  }
}

type Fetcher = (url: string, ms: number) => Promise<TileJson>;

/**
 * Try the direct tile host, then the same-origin proxy. Returns null only when
 * neither answers — the caller then reports "no tiles" instead of showing a
 * silently blank map.
 */
export async function chooseTileBase(
  fetchJson: Fetcher = fetchJsonWithTimeout,
  directUrl: string = CONFIG.map.vectorSourceUrl,
  glyphsUrl: string = CONFIG.map.glyphsUrl,
  timeoutMs = 3500,
): Promise<TileBase | null> {
  const proxied = proxyUrl(directUrl);
  const candidates = proxied === directUrl ? [directUrl] : [directUrl, proxied];

  for (const url of candidates) {
    const viaProxy = url === proxied;
    try {
      const tj = await fetchJson(url, timeoutMs);
      const tiles = Array.isArray(tj.tiles) ? tj.tiles.filter((t) => typeof t === 'string' && t.includes('{z}')) : [];
      if (!tiles.length) continue;
      return {
        source: {
          type: 'vector',
          tiles: tiles.map((t) => (viaProxy ? proxyUrl(t) : t)),
          ...(typeof tj.minzoom === 'number' ? { minzoom: tj.minzoom } : {}),
          ...(typeof tj.maxzoom === 'number' ? { maxzoom: tj.maxzoom } : {}),
        },
        glyphs: viaProxy ? proxyUrl(glyphsUrl) : glyphsUrl,
        via: viaProxy ? 'proxy' : 'direct',
      };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
