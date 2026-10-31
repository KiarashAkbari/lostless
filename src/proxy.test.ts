import { describe, it, expect } from 'vitest';
import { CONFIG, previewProxied, svcUrl, rewriteStyleUrls } from './config';

const PREVIEW_HOST = '4173-imdv5soxlpsplt9mog45s.e2b.app';
const PROD_HOST = 'kiarashakbari.github.io';
const LOCAL_HOST = 'localhost';

describe('preview proxy selection', () => {
  it('only *.e2b.app hosts are treated as the Arena preview', () => {
    expect(previewProxied(PREVIEW_HOST)).toBe(true);
    expect(previewProxied('e2b.app')).toBe(true);
    expect(previewProxied(PROD_HOST)).toBe(false);
    expect(previewProxied(LOCAL_HOST)).toBe(false);
    expect(previewProxied('')).toBe(false); // node / tests: no window
  });

  it('production and local hosts keep the direct https URLs', () => {
    expect(svcUrl(CONFIG.map.darkStyleUrl, PROD_HOST)).toBe('https://tiles.openfreemap.org/styles/dark');
    expect(svcUrl(CONFIG.nominatim.baseUrl, LOCAL_HOST)).toBe('https://nominatim.openstreetmap.org');
    expect(svcUrl(CONFIG.routing.valhalla.baseUrl, PROD_HOST)).toBe('https://valhalla1.openstreetmap.de');
    expect(svcUrl(CONFIG.routing.valhalla.fallbackBaseUrl, PROD_HOST)).toBe('https://valhalla2.openstreetmap.de');
    expect(svcUrl(CONFIG.routing.osrm.baseUrl, PROD_HOST)).toBe('https://router.project-osrm.org');
    expect(svcUrl(CONFIG.map.osmRasterUrl, PROD_HOST)).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });

  it('preview hosts are rewritten to same-origin /proxy/* paths', () => {
    expect(svcUrl(CONFIG.map.darkStyleUrl, PREVIEW_HOST)).toBe('/proxy/ofm/styles/dark');
    expect(svcUrl(CONFIG.map.lightStyleUrl, PREVIEW_HOST)).toBe('/proxy/ofm/styles/positron');
    expect(svcUrl(CONFIG.nominatim.baseUrl + '/search?x=1', PREVIEW_HOST)).toBe('/proxy/nominatim/search?x=1');
    expect(svcUrl(CONFIG.routing.valhalla.baseUrl + '/route?json={}', PREVIEW_HOST)).toBe('/proxy/valhalla1/route?json={}');
    expect(svcUrl(CONFIG.routing.valhalla.fallbackBaseUrl + '/route', PREVIEW_HOST)).toBe('/proxy/valhalla2/route');
    expect(svcUrl(CONFIG.routing.osrm.baseUrl + '/route/v1/driving/1,2;3,4', PREVIEW_HOST)).toBe('/proxy/osrm/route/v1/driving/1,2;3,4');
    expect(svcUrl(CONFIG.map.osmRasterUrl, PREVIEW_HOST)).toBe('/proxy/osm/{z}/{x}/{y}.png');
  });

  it('unknown hosts are left untouched even in the preview', () => {
    expect(svcUrl('https://example.com/x', PREVIEW_HOST)).toBe('https://example.com/x');
  });

  it('style JSONs get every known absolute URL rewritten (sources, sprite, glyphs)', () => {
    const style = {
      version: 8,
      sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        planet: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        ne2: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'] },
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
      },
      layers: [{ id: 'background', type: 'background' }],
      name: 'dark',
    };
    const out = rewriteStyleUrls(style, PREVIEW_HOST);
    expect(out.sprite).toBe('/proxy/ofm/sprites/ofm_f384/ofm');
    expect(out.glyphs).toBe('/proxy/ofm/fonts/{fontstack}/{range}.pbf');
    expect(out.sources.planet.url).toBe('/proxy/ofm/planet');
    expect(out.sources.ne2.tiles[0]).toBe('/proxy/ofm/natural_earth/ne2sr/{z}/{x}/{y}.png');
    expect(out.sources.osm.tiles[0]).toBe('/proxy/osm/{z}/{x}/{y}.png');
    expect(out.layers[0].id).toBe('background');
    // production: untouched
    expect(rewriteStyleUrls(style, PROD_HOST)).toEqual(style);
  });
});
