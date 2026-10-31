import type { MapStyle, TravelMode } from './config';

export type { TravelMode, MapStyle };

/** A searchable / pinnable place. Coordinates are WGS84. */
export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** rough category from Nominatim, e.g. "city", "cafe", "station" */
  kind?: string;
}

/** One turn-by-turn instruction. `location` is [lon, lat] of the maneuver point. */
export interface RouteStep {
  instruction: string;
  street: string;
  distanceM: number;
  durationS: number;
  /** raw maneuver type + modifier, e.g. ("turn", "left") — used for the glyph */
  type: string;
  modifier?: string;
  location: [number, number];
}

export interface RouteResult {
  /** full route polyline, [lon, lat][] */
  coords: [number, number][];
  steps: RouteStep[];
  distanceM: number;
  durationS: number;
}

export type GpsStatus = 'locating' | 'ok' | 'denied' | 'error' | 'unsupported';

/** per-device UI settings, persisted in localStorage */
export interface Settings {
  /** spoken turn-by-turn while navigating */
  voice: boolean;
  /** lite mode: raster map + no animations — for older / weaker phones */
  perf: boolean;
  /** prefer Persian (name:fa) place labels on the map */
  faLabels: boolean;
  /** pinned map style ('auto' follows the theme) */
  mapStyle: MapStyle;
}

export type SheetSnap = 'hidden' | 'peek' | 'full';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface Banner {
  id: number;
  kind: 'error' | 'info';
  msg: string;
  tag?: string;
  action?: BannerAction;
  /** optional second action (e.g. "USE RASTER MAP" next to RETRY) */
  action2?: BannerAction;
}
