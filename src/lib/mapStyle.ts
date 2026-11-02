/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lostless · hand-written basemap
 * ─────────────────────────────────────────────────────────────────────────────
 *  A purpose-built map style instead of a downloaded one (Positron/Liberty pull
 *  ~110 layers plus a sprite sheet and a second style request). This one:
 *
 *   · ~35 layers, most with a high minzoom, so the render loop stays cheap
 *     while you drag and pinch
 *   · no sprite sheet, no external icons — points of interest are drawn as
 *     plain circles, so the map needs one style object and one font family
 *   · road hierarchy in colour, not just width: warm motorways, white
 *     primaries, soft local streets with casings, exactly like a road atlas
 *   · two palettes: "paper" (light) and "slate" (dark), both low-saturation so
 *     the UI's black/grey shell stays the loudest thing on screen
 *
 *  Source data is OpenMapTiles (OpenFreeMap's planet build), so every
 *  `source-layer` below is a standard OMT layer: water, landuse, landcover,
 *  park, transportation, transportation_name, building, boundary, place,
 *  water_name, poi, aeroway.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { StyleSpecification } from 'maplibre-gl';
import { CONFIG } from '../config';

export type BaseTheme = 'light' | 'dark';

interface Palette {
  land: string;
  residential: string;
  commercial: string;
  park: string;
  wood: string;
  grass: string;
  farm: string;
  sand: string;
  water: string;
  waterLine: string;
  waterway: string;
  boundary: string;
  street: string;
  streetCasing: string;
  secondary: string;
  secondaryCasing: string;
  primary: string;
  primaryCasing: string;
  motorway: string;
  motorwayCasing: string;
  path: string;
  rail: string;
  building: string;
  buildingEdge: string;
  label: string;
  halo: string;
  waterLabel: string;
  poi: string;
  poiFood: string;
  poiShop: string;
}

const PAPER: Palette = {
  // warm paper, the way a printed road atlas reads
  land: '#f6f3ec',
  residential: '#f1ede4',
  commercial: '#eee9de',
  park: '#cfe6c4',
  wood: '#c3ddb8',
  grass: '#dfedd4',
  farm: '#f0eddd',
  sand: '#f3e8d3',
  water: '#a8c8e2',
  waterLine: '#8fb4d4',
  waterway: '#9dc0dc',
  boundary: '#c9bfae',
  street: '#ffffff',
  streetCasing: '#e2dccf',
  secondary: '#ffffff',
  secondaryCasing: '#dcd4c4',
  primary: '#fff6d8',
  primaryCasing: '#e3d5ac',
  motorway: '#ffd98a',
  motorwayCasing: '#dcb45f',
  path: '#f2eee3',
  rail: '#cfc8b9',
  building: '#e7e0d2',
  buildingEdge: '#dbd2c1',
  label: '#33352f',
  halo: 'rgba(255,255,255,0.95)',
  waterLabel: '#5f7f99',
  poi: '#8b8578',
  poiFood: '#b2632f',
  poiShop: '#6d6fa8',
};

const NIGHT: Palette = {
  // night driving: near-black ground, road network lifted out of it
  land: '#0c0f12',
  residential: '#101418',
  commercial: '#12171c',
  park: '#0f1a13',
  wood: '#0c1710',
  grass: '#101b13',
  farm: '#11150f',
  sand: '#191712',
  water: '#0b1a26',
  waterLine: '#16303f',
  waterway: '#122734',
  boundary: '#2b3138',
  street: '#1c2228',
  streetCasing: '#05070a',
  secondary: '#262e36',
  secondaryCasing: '#05070a',
  primary: '#39434e',
  primaryCasing: '#06090c',
  motorway: '#5c5136',
  motorwayCasing: '#0a0d10',
  path: '#171c21',
  rail: '#20262d',
  building: '#161a1f',
  buildingEdge: '#1c2127',
  label: '#ccd3d8',
  halo: 'rgba(6,9,11,0.94)',
  waterLabel: '#6f93a8',
  poi: '#8e9499',
  poiFood: '#c08a56',
  poiShop: '#8d8fc0',
};

/** zoom → value ramp: call with (zoom, value, zoom, value, ...) */
const ramp = (...stops: number[]) => ['interpolate', ['exponential', 1.35], ['zoom'], ...stops];

const roadClasses = (...classes: string[]) => ['match', ['get', 'class'], classes, true, false];

/** a road is a casing plus a fill. Both need their own width ramp: MapLibre only
 *  allows the `zoom` expression inside a top-level interpolate/step, so a casing
 *  cannot be written as `['+', ramp, 2]`. */
function road(
  id: string,
  filter: unknown,
  minzoom: number,
  stops: number[],
  casing: string,
  fill: string,
  extra: { casingExtra?: number; dash?: number[] } = {},
) {
  const casingExtra = extra.casingExtra ?? 1.6;
  const width = ramp(...stops);
  const casingWidth = ramp(...stops.map((v, i) => (i % 2 ? v + casingExtra : v)));
  return [
    {
      id: `${id}-casing`,
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom,
      filter,
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
      paint: {
        'line-color': casing,
        'line-width': casingWidth,
        'line-opacity': 1,
      },
    },
    {
      id: `${id}-fill`,
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom,
      filter,
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
      paint: {
        'line-color': fill,
        'line-width': width,
        ...(extra.dash ? { 'line-dasharray': extra.dash } : {}),
      },
    },
  ];
}

const notTunnel = ['!', ['in', ['get', 'brunnel'], ['literal', ['tunnel']]]];

/** real OpenMapTiles `poi.class` values — anything else is ignored */
const POI_CLASSES = [
  'restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'bakery',
  'supermarket', 'convenience', 'mall', 'clothing_store', 'hardware', 'florist',
  'hotel', 'hostel', 'motel', 'guest_house',
  'bus', 'railway', 'halt', 'fuel', 'parking', 'taxi', 'ferry',
  'hospital', 'pharmacy', 'doctor', 'dentist',
  'school', 'university', 'college', 'kindergarten', 'library',
  'park', 'playground', 'museum', 'attraction', 'viewpoint', 'theatre', 'cinema',
  'bank', 'post', 'police', 'fire_station', 'townhall',
];
const POI_FOOD = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'bakery'];
const POI_SHOP = ['supermarket', 'convenience', 'mall', 'clothing_store', 'hardware', 'florist'];
/** only the handful worth a text label at street zoom */
const POI_LABEL_CLASSES = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'hotel', 'supermarket', 'railway', 'fuel', 'museum', 'park', 'pharmacy'];

/** layer literals are validated by the map at runtime; the TS union is too
 *  rigid for expression-heavy paint blocks, so cast at the boundary */
const L = (layer: unknown) => layer as StyleSpecification['layers'][number];

export interface TileBase {
  /** a TileJSON url, or an already-expanded tile template list */
  source: { type: 'vector'; url?: string; tiles?: string[]; minzoom?: number; maxzoom?: number };
  glyphs: string;
  /** how the tile URLs were resolved (diagnostics only) */
  via?: 'direct' | 'proxy';
}

export function buildBaseStyle(theme: BaseTheme, base?: TileBase): StyleSpecification {
  const p = theme === 'dark' ? NIGHT : PAPER;
  const font = CONFIG.map.fonts.regular;
  const fontBold = CONFIG.map.fonts.bold;
  const fontItalic = CONFIG.map.fonts.italic;

  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': p.land } },

    // ── ground colour: built-up areas are a touch warmer than open land ─────
    {
      id: 'landuse',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      minzoom: 9,
      filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail', 'industrial'], true, false],
      paint: {
        'fill-color': ['match', ['get', 'class'], ['commercial', 'retail', 'industrial'], p.commercial, p.residential],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 13, 1],
      },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': p.park, 'fill-opacity': 0.95 },
    },
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      minzoom: 8,
      filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false],
      paint: { 'fill-color': p.wood, 'fill-opacity': 0.9 },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      minzoom: 11,
      filter: ['match', ['get', 'class'], ['grass', 'meadow', 'farmland'], true, false],
      paint: { 'fill-color': p.grass, 'fill-opacity': 0.75 },
    },
    {
      id: 'landcover-farm',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      minzoom: 9,
      filter: ['match', ['get', 'class'], ['farmland', 'orchard', 'vineyard'], true, false],
      paint: { 'fill-color': p.farm, 'fill-opacity': 0.55 },
    },
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      minzoom: 9,
      filter: ['match', ['get', 'class'], ['sand', 'beach', 'ice', 'glacier'], true, false],
      paint: { 'fill-color': p.sand, 'fill-opacity': 0.9 },
    },

    // ── water ───────────────────────────────────────────────────────────────
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'fill-color': p.water, 'fill-antialias': false },
    },
    {
      id: 'water-outline',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'water',
      minzoom: 6,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: {
        'line-color': p.waterLine,
        'line-width': ramp(6, 0.6, 12, 1.2, 18, 2),
        'line-opacity': 0.9,
      },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      minzoom: 11,
      paint: {
        'line-color': p.waterway,
        'line-width': ramp(11, 0.5, 16, 1.6, 20, 6),
      },
    },

    // ── airports, borders, railways ────────────────────────────────────────
    {
      id: 'aeroway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: ['match', ['get', 'class'], ['runway', 'taxiway'], true, false],
      paint: { 'line-color': p.streetCasing, 'line-width': ramp(10, 1, 14, 4, 18, 22) },
    },
    {
      id: 'boundary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      minzoom: 3,
      filter: ['<=', ['get', 'admin_level'], 4],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.boundary,
        'line-width': ['case', ['<=', ['get', 'admin_level'], 2], 1.1, 0.7],
        'line-dasharray': [3, 2],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['==', ['get', 'class'], 'rail'],
      paint: {
        'line-color': p.rail,
        'line-width': ramp(12, 0.6, 18, 1.8, 20, 3),
        'line-dasharray': [3, 3],
      },
    },

    // ── tunnels: a dimmer, dashed hint of the road below ────────────────────
    {
      id: 'tunnel',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['all', ['==', ['get', 'brunnel'], 'tunnel'], roadClasses('motorway', 'trunk', 'primary', 'secondary', 'tertiary')],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.streetCasing,
        'line-width': ramp(13, 2, 17, 6, 20, 16),
        'line-dasharray': [2, 2],
        'line-opacity': 0.8,
      },
    },

    // ── the road ladder: local → arterial → motorway ────────────────────────
    ...road(
      'road-street',
      ['all', notTunnel, roadClasses('service', 'track', 'minor')],
      12,
      [12, 0.5, 15, 1.6, 18, 6],
      p.streetCasing,
      p.street,
      { casingExtra: 1.2 },
    ),
    ...road(
      'road-secondary',
      ['all', notTunnel, roadClasses('secondary', 'tertiary')],
      9,
      [9, 0.6, 13, 1.8, 17, 6],
      p.secondaryCasing,
      p.secondary,
    ),
    ...road(
      'road-primary',
      ['all', notTunnel, roadClasses('primary', 'trunk')],
      6,
      [6, 0.5, 12, 2.2, 17, 8],
      p.primaryCasing,
      p.primary,
    ),
    ...road(
      'road-motorway',
      ['all', notTunnel, ['==', ['get', 'class'], 'motorway']],
      4,
      [4, 0.7, 10, 2, 16, 11],
      p.motorwayCasing,
      p.motorway,
      { casingExtra: 2 },
    ),

    // ── footpaths: dotted, only when you are close enough to care ───────────
    {
      id: 'path',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 15,
      filter: ['all', notTunnel, roadClasses('path', 'pedestrian', 'footway', 'steps')],
      paint: {
        'line-color': p.path,
        'line-width': ramp(15, 0.8, 18, 1.6, 20, 3),
        'line-dasharray': [1.5, 1.8],
      },
    },

    // ── buildings appear late, like a road atlas ────────────────────────────
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        'fill-color': p.building,
        'fill-outline-color': p.buildingEdge,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.35, 17, 0.9],
      },
    },

    // ── labels ──────────────────────────────────────────────────────────────
    {
      id: 'label-water',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      minzoom: 10,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': [fontItalic],
        'text-size': ramp(10, 10, 16, 13),
        'text-letter-spacing': 0.12,
        'text-max-width': 7,
        'text-padding': 4,
      },
      paint: {
        'text-color': p.waterLabel,
        'text-halo-color': p.halo,
        'text-halo-width': 1,
      },
    },
    {
      id: 'label-street',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': [font],
        'text-size': ramp(14, 10, 18, 13),
        'symbol-spacing': 300,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-padding': 1,
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.1 },
    },
    {
      id: 'label-road',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 11,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']],
        'text-font': [fontBold],
        'text-size': ramp(11, 10, 16, 13),
        'symbol-spacing': 400,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-padding': 1,
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.2 },
    },
    // cities / towns / villages, one layer each so density stays sane
    ...[
      { id: 'label-city', cls: ['city'], minzoom: 4, size: [4, 12, 10, 15, 14, 18] },
      { id: 'label-town', cls: ['town'], minzoom: 8, size: [8, 11, 13, 14, 17, 16] },
      { id: 'label-village', cls: ['village', 'hamlet', 'isolated_dwelling'], minzoom: 11.5, size: [11, 10, 15, 12, 18, 14] },
      { id: 'label-suburb', cls: ['suburb', 'quarter', 'neighbourhood'], minzoom: 13, size: [12, 10, 16, 12, 18, 13] },
    ].map((c) => ({
      id: c.id,
      type: 'symbol' as const,
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: c.minzoom,
      filter: ['match', ['get', 'class'], c.cls, true, false],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': c.id === 'label-city' || c.id === 'label-town' ? [fontBold] : [font],
        'text-size': ramp(...c.size),
        'text-max-width': 8,
        'text-padding': 2,
        'text-letter-spacing': c.id === 'label-suburb' ? 0.06 : 0.02,
      },
      paint: {
        'text-color': p.label,
        'text-halo-color': p.halo,
        'text-halo-width': c.id === 'label-city' ? 1.6 : 1.2,
      },
    })),

    // ── points of interest: small dots, no icon sheet ───────────────────────
    {
      id: 'poi-dot',
      type: 'circle',
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 16,
      filter: [
        'all',
        ['<=', ['get', 'rank'], 40],
        ['match', ['get', 'class'], POI_CLASSES, true, false],
      ],
      paint: {
        'circle-radius': ramp(16, 2.2, 19, 3.6),
        'circle-color': [
          'match',
          ['get', 'class'],
          POI_FOOD, p.poiFood,
          POI_SHOP, p.poiShop,
          p.poi,
        ],
        'circle-stroke-color': p.halo,
        'circle-stroke-width': 1,
      },
    },
    {
      id: 'poi-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 17,
      filter: [
        'all',
        ['any', ['!', ['has', 'rank']], ['<=', ['get', 'rank'], 20]],
        ['match', ['get', 'class'], POI_LABEL_CLASSES, true, false],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': [font],
        'text-size': 10.5,
        'text-max-width': 7,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'text-padding': 3,
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1 },
    },
  ].map(L);

  return {
    version: 8,
    name: `lostless-${theme}`,
    sources: {
      openmaptiles: base?.source ?? { type: 'vector', url: CONFIG.map.vectorSourceUrl },
    },
    glyphs: base?.glyphs ?? CONFIG.map.glyphsUrl,
    layers,
  };
}
