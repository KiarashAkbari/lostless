import { describe, it, expect } from 'vitest';
// the official MapLibre style spec: catches invalid expressions (e.g. `zoom`
// used inside arithmetic, which silently kills a layer at runtime)
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildBaseStyle } from './mapStyle';
import { CONFIG, previewProxied, rewriteStyleUrls } from '../config';

type Style = ReturnType<typeof buildBaseStyle>;

/** MapLibre expressions are nested arrays; walk them and check the shapes we emit. */
function walk(node: unknown, visit: (n: unknown[]) => void): void {
  if (Array.isArray(node)) {
    visit(node);
    for (const child of node) walk(child, visit);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) walk(v, visit);
  }
}

describe('built-in basemap', () => {
  const light = buildBaseStyle('light');
  const dark = buildBaseStyle('dark');

  it('passes the official MapLibre style validator', () => {
    for (const style of [light, dark]) {
      const errors = validateStyleMin(style as never);
      expect(errors.map((e) => `${e.message}`)).toEqual([]);
    }
  });

  it('is a valid v8 style with the configured vector source and glyphs', () => {
    expect(light.version).toBe(8);
    expect(light.sources.openmaptiles).toEqual({ type: 'vector', url: CONFIG.map.vectorSourceUrl });
    expect(light.glyphs).toBe(CONFIG.map.glyphsUrl);
    expect(light.glyphs).toContain('{fontstack}');
  });

  it('has unique layer ids and valid source references', () => {
    const ids = light.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const layer of light.layers) {
      if (layer.type === 'background') continue;
      expect(layer.source).toBe('openmaptiles');
      expect(typeof layer['source-layer']).toBe('string');
    }
  });

  it('stays small enough to render fast (fewer layers than a downloaded style)', () => {
    // Positron/Liberty ship 55–111 layers; ours is deliberately lean
    expect(light.layers.length).toBeLessThan(45);
    expect(light.layers.length).toBeGreaterThan(25);
    // heavy layers must wait for street zoom
    const byId = new Map(light.layers.map((l) => [l.id, l]));
    expect((byId.get('building') as { minzoom: number }).minzoom).toBeGreaterThanOrEqual(14);
    expect((byId.get('poi-dot') as { minzoom: number }).minzoom).toBeGreaterThanOrEqual(15);
    expect((byId.get('label-street') as { minzoom: number }).minzoom).toBeGreaterThanOrEqual(13);
  });

  it('draws the road ladder in order: local, secondary, primary, motorway', () => {
    const order = light.layers.map((l) => l.id);
    const i = (id: string) => order.indexOf(id);
    expect(i('road-street-fill')).toBeGreaterThan(-1);
    expect(i('road-secondary-fill')).toBeGreaterThan(i('road-street-fill'));
    expect(i('road-primary-fill')).toBeGreaterThan(i('road-secondary-fill'));
    expect(i('road-motorway-fill')).toBeGreaterThan(i('road-primary-fill'));
    // labels and buildings sit above the roads
    expect(i('building')).toBeGreaterThan(i('road-motorway-fill'));
    expect(i('label-road')).toBeGreaterThan(i('building'));
  });

  it('light and dark palettes are actually different, and neither is blue', () => {
    const bg = (s: Style) => (s.layers[0].paint as unknown as Record<string, string>)['background-color'];
    expect(bg(light)).not.toBe(bg(dark));
    const water = (s: Style) => {
      const l = s.layers.find((x) => x.id === 'water') as unknown as { paint: Record<string, string> };
      return l.paint['fill-color'];
    };
    expect(water(light)).not.toBe(water(dark));
    // water is a desaturated grey-blue, not a saturated blue
    const hex = water(light).replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(60);
  });

  it('every interpolate expression is well formed (even stops, ascending zooms)', () => {
    for (const style of [light, dark]) {
      walk(style.layers, (node) => {
        if (node[0] !== 'interpolate' && node[0] !== 'interpolate-hcl') return;
        const stops = node.slice(3);
        expect(stops.length % 2, `odd stops in ${JSON.stringify(node)}`).toBe(0);
        expect(stops.length).toBeGreaterThanOrEqual(4);
        let last = -Infinity;
        for (let i = 0; i < stops.length; i += 2) {
          expect(typeof stops[i], `non-numeric zoom in ${JSON.stringify(node)}`).toBe('number');
          expect(stops[i]).toBeGreaterThan(last);
          last = stops[i] as number;
        }
      });
    }
  });

  it('has no undefined or NaN leaking into the spec', () => {
    const json = JSON.stringify(light) + JSON.stringify(dark);
    expect(json).not.toContain('undefined');
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('null,');
  });

  it('every label layer uses a font stack the tile host actually serves', () => {
    const served = new Set<string>(Object.values(CONFIG.map.fonts));
    for (const layer of light.layers) {
      if (layer.type !== 'symbol') continue;
      const fonts = (layer.layout as { 'text-font'?: string[] })['text-font'] ?? [];
      expect(fonts.length).toBeGreaterThan(0);
      for (const f of fonts) expect(served.has(f)).toBe(true);
    }
  });

  it('routes all URLs through the preview proxy when needed', () => {
    expect(previewProxied('abc.e2b.app')).toBe(true);
    const proxied = rewriteStyleUrls(buildBaseStyle('dark'), 'abc.e2b.app');
    expect((proxied.sources.openmaptiles as { url: string }).url.startsWith('/proxy/')).toBe(true);
    expect(String(proxied.glyphs).startsWith('/proxy/')).toBe(true);
  });
});
