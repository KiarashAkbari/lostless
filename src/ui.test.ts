import { describe, it, expect, beforeEach } from 'vitest';
import { CONFIG, styleUrlFor } from './config';
import { getSettings, setSettings } from './lib/storage';
import { weakHardware } from './lib/perf';
import { speechSupported, speak, cancelSpeech } from './lib/voice';
import { circlePolygon } from './lib/geo';

describe('settings persistence', () => {
  beforeEach(() => {
    // node env: localStorage may be absent — storage helpers must not throw
  });

  it('defaults come from CONFIG.ui', () => {
    const s = getSettings();
    expect(s.voice).toBe(CONFIG.ui.voiceDefault);
    expect(s.faLabels).toBe(CONFIG.ui.faLabelsDefault);
    expect(s.mapStyle).toBe(CONFIG.ui.mapStyleDefault);
    expect(typeof s.perf).toBe('boolean');
  });

  it('setSettings/getSettings round-trips when localStorage exists', () => {
    if (typeof localStorage === 'undefined') return; // node env — skip
    setSettings({ voice: true, perf: true, faLabels: true, mapStyle: 'liberty' });
    const s = getSettings();
    expect(s.voice).toBe(true);
    expect(s.perf).toBe(true);
    expect(s.faLabels).toBe(true);
    expect(s.mapStyle).toBe('liberty');
    setSettings(getSettings()); // restore defaults-ish
    setSettings({ voice: false, perf: false, faLabels: false, mapStyle: 'auto' });
  });
});

describe('style picker', () => {
  it('auto follows the theme, pinned styles use their own URLs', () => {
    expect(styleUrlFor('dark', 'auto')).toBe(CONFIG.map.darkStyleUrl);
    expect(styleUrlFor('light', 'auto')).toBe(CONFIG.map.lightStyleUrl);
    expect(styleUrlFor('light', 'dark')).toBe(CONFIG.map.darkStyleUrl);
    expect(styleUrlFor('dark', 'bright')).toBe(CONFIG.map.extraStyleUrls.bright);
    expect(styleUrlFor('dark', 'liberty')).toBe(CONFIG.map.extraStyleUrls.liberty);
    expect(CONFIG.map.extraStyleUrls.liberty.startsWith('https://tiles.openfreemap.org/styles/')).toBe(true);
  });
});

describe('lite-mode + voice guards', () => {
  it('weakHardware does not throw without navigator', () => {
    expect(typeof weakHardware()).toBe('boolean');
  });
  it('voice is a safe no-op without speechSynthesis', () => {
    expect(speechSupported()).toBe(false); // node env
    expect(() => speak('hello')).not.toThrow();
    expect(() => cancelSpeech()).not.toThrow();
  });
});

describe('accuracy circle polygon', () => {
  it('builds a closed ring around the center', () => {
    const ring = circlePolygon([8.68, 50.11], 30);
    expect(ring.length).toBeGreaterThan(10);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // ~30 m north of the center should be ~0.00027° lat higher
    const top = ring.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(top[1] - 50.11).toBeGreaterThan(0.0002);
    expect(top[1] - 50.11).toBeLessThan(0.0004);
  });
});
