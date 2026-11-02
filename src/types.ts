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

/** One lane at a junction: which directions it serves, and whether it is the one to be in */
export interface Lane {
  directions: string[];
  active: boolean;
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
  /**
   * Router-supplied phrasing. Valhalla generates a separate sentence for each
   * moment of the approach — that cadence is most of why commercial navigators
   * sound natural, so we speak these instead of gluing words together.
   */
  verbal?: string;
  /** advance warning, spoken well before the turn ("In 400 meters, turn right…") */
  verbalAlert?: string;
  /** what to say right after completing the maneuver */
  verbalPost?: string;
  /** true when this maneuver needs the next one announced too (close junctions) */
  multiCue?: boolean;
  lanes?: Lane[];
  /** motorway exit number, e.g. "42" */
  exitNumber?: string;
  toll?: boolean;
  highway?: boolean;
  /** posted limit in km/h when the router knows it */
  speedLimit?: number;
}

export interface RouteResult {
  /** full route polyline, [lon, lat][] */
  coords: [number, number][];
  steps: RouteStep[];
  distanceM: number;
  durationS: number;
  /** summary flags the router reports for the whole trip */
  hasToll?: boolean;
  hasHighway?: boolean;
  hasFerry?: boolean;
}

/** routing preferences passed to the engine as costing options */
export interface RouteAvoid {
  tolls: boolean;
  highways: boolean;
  ferries: boolean;
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
  /** prefer routes without tolls / motorways / ferries */
  avoid?: RouteAvoid;
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
