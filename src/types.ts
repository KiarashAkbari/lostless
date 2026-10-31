import type { TravelMode } from './config';

export type { TravelMode };

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

export type SheetSnap = 'hidden' | 'peek' | 'full';

export interface Banner {
  id: number;
  kind: 'error' | 'info';
  msg: string;
  tag?: string;
  action?: { label: string; onClick: () => void };
}
