import { describe, it, expect } from 'vitest';
import { CONFIG, type TravelMode } from './config';

const MODES: TravelMode[] = ['car', 'walk', 'bike'];

describe('config integrity', () => {
  it('every travel mode has a Valhalla costing and an OSRM profile', () => {
    for (const m of MODES) {
      expect(CONFIG.routing.valhalla.costing[m]).toBeTruthy();
      expect(CONFIG.routing.osrm.profiles[m]).toBeTruthy();
    }
  });
  it('routing engine is one of the supported adapters', () => {
    expect(['valhalla', 'osrm']).toContain(CONFIG.routing.engine);
  });
  it('Nominatim rate limit respects the 1 req/s usage policy', () => {
    expect(CONFIG.nominatim.minIntervalMs).toBeGreaterThanOrEqual(1000);
  });
  it('tile style URLs are https', () => {
    expect(CONFIG.map.darkStyleUrl.startsWith('https://')).toBe(true);
    expect(CONFIG.map.lightStyleUrl.startsWith('https://')).toBe(true);
  });
});
