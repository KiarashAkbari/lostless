import { describe, it, expect, vi } from 'vitest';
import { chooseTileBase } from './tilebase';
import type { TileJson } from './tilebase';

const DIRECT = 'https://tiles.openfreemap.org/planet';
const TLS = ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'];

const answer = (tj: TileJson) => async () => tj;
const fail = async () => {
  throw new Error('offline');
};

describe('tile base selection', () => {
  it('prefers the direct CDN when it answers', async () => {
    const direct = vi.fn(answer({ tiles: TLS, minzoom: 0, maxzoom: 14 }));
    const base = await chooseTileBase(direct, DIRECT);
    expect(base?.via).toBe('direct');
    expect(base?.source.tiles).toEqual(TLS);
    expect(base?.source.maxzoom).toBe(14);
    expect(base?.glyphs).not.toContain('/proxy'); // glyphs follow the same base
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it('falls back to the same-origin proxy and rewrites every tile URL', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECT) throw new Error('blocked');
      return { tiles: TLS };
    });
    const base = await chooseTileBase(fetcher, DIRECT);
    expect(base?.via).toBe('proxy');
    expect(base?.source.tiles).toEqual(['/proxy/ofm/planet/{z}/{x}/{y}.pbf']);
    expect(base?.glyphs.startsWith('/proxy/')).toBe(true);
  });

  it('returns null when nothing answers, so the UI can say so', async () => {
    const base = await chooseTileBase(async () => {
      await fail();
      return {};
    }, DIRECT);
    expect(base).toBeNull();
  });

  it('rejects a TileJSON without usable tile templates', async () => {
    const fetcher = vi.fn(answer({ tiles: [] }));
    expect(await chooseTileBase(fetcher, DIRECT)).toBeNull();
  });

  it('a base that never answers is abandoned when the request aborts', async () => {
    // emulate real fetch: aborts when the signal fires
    const stub = vi.fn((url: string, init?: RequestInit) => {
      if (url !== DIRECT) return Promise.resolve({ ok: true, status: 200, json: async () => ({ tiles: TLS }) } as Response);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    vi.stubGlobal('fetch', stub);
    const started = Date.now();
    const base = await chooseTileBase(undefined, DIRECT, 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', 40);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(base?.via).toBe('proxy');
    vi.unstubAllGlobals();
  });
});
