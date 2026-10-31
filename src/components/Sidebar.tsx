import { useState } from 'react';
import { CONFIG, type MapStyle } from '../config';
import type { Place, Settings } from '../types';
import type { Theme } from '../hooks/useTheme';
import { speechSupported } from '../lib/voice';

type Tab = 'saved' | 'settings' | 'about';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  favorites: Place[];
  onPick: (p: Place) => void;
  onRemoveFav: (id: string) => void;
}

const STYLE_CHOICES: Array<{ id: MapStyle; label: string }> = [
  { id: 'auto', label: 'AUTO' },
  { id: 'dark', label: 'DARK' },
  { id: 'light', label: 'LIGHT' },
  { id: 'liberty', label: 'LIBERTY' },
  { id: 'bright', label: 'BRIGHT' },
];

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick}>
      <span className="knob" />
    </button>
  );
}

/**
 * Slide-in side drawer: saved places, settings (theme, voice, lite mode,
 * Persian labels, map style), about. Curved glass panel, phone-first.
 */
export function Sidebar(props: SidebarProps) {
  const { open, onClose, theme, onToggleTheme, settings, onSettings, favorites, onPick, onRemoveFav } = props;
  const [tab, setTab] = useState<Tab>('saved');
  if (!open) return null;

  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="sidebar" onClick={(e) => e.stopPropagation()} aria-label="menu">
        <div className="sb-head">
          <span className="logo mono">
            lostless<span className="cursor">_</span>
          </span>
          <button className="icon-btn mono sb-close" onClick={onClose} aria-label="close menu">×</button>
        </div>

        <div className="seg mono" role="tablist" aria-label="sidebar sections">
          {(['saved', 'settings', 'about'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {tab === 'saved' && (
          <div className="sb-body">
            <div className="body-label mono dim">SAVED PLACES // {favorites.length}</div>
            {favorites.length === 0 && (
              <p className="mono dim sb-empty">
                NOTHING SAVED YET
                <br />
                TAP ★ ON A DESTINATION TO KEEP IT HERE
              </p>
            )}
            <ul className="fav-list">
              {favorites.map((f) => (
                <li key={f.id}>
                  <button className="fav-row" onClick={() => { onPick(f); onClose(); }}>
                    <span className="r-name">{f.name}</span>
                    <span className="r-kind mono">{f.kind ?? 'place'}</span>
                  </button>
                  <button className="icon-btn mono" onClick={() => onRemoveFav(f.id)} aria-label={`remove ${f.name.split(',')[0]}`}>×</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'settings' && (
          <div className="sb-body">
            <div className="body-label mono dim">APPEARANCE</div>
            <div className="set-row">
              <span className="set-label">{theme === 'dark' ? 'DARK MODE' : 'LIGHT MODE'}</span>
              <Toggle on={theme === 'dark'} onClick={onToggleTheme} label="toggle dark mode" />
            </div>
            <div className="body-label mono dim" style={{ marginTop: 14 }}>MAP</div>
            <div className="seg wrap mono" role="group" aria-label="map style">
              {STYLE_CHOICES.map((c) => (
                <button key={c.id} className={settings.mapStyle === c.id ? 'active' : ''} onClick={() => set({ mapStyle: c.id })}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="set-row">
              <span className="set-label">PERSIAN LABELS (FA)</span>
              <Toggle on={settings.faLabels} onClick={() => set({ faLabels: !settings.faLabels })} label="toggle Persian map labels" />
            </div>
            <div className="body-label mono dim" style={{ marginTop: 14 }}>NAVIGATION</div>
            <div className="set-row">
              <span className="set-label">VOICE GUIDANCE{speechSupported() ? '' : ' (N/A HERE)'}</span>
              <Toggle on={settings.voice && speechSupported()} onClick={() => set({ voice: !settings.voice })} label="toggle voice guidance" />
            </div>
            <div className="set-row">
              <span className="set-label">LITE MODE — OLDER PHONES</span>
              <Toggle on={settings.perf} onClick={() => set({ perf: !settings.perf })} label="toggle lite mode" />
            </div>
            <p className="mono dim sb-note">
              LITE MODE USES LIGHTWEIGHT RASTER TILES + NO ANIMATIONS — SMOOTH ON OLDER HARDWARE.
            </p>
          </div>
        )}

        {tab === 'about' && (
          <div className="sb-body">
            <div className="body-label mono dim">ABOUT</div>
            <p className="sb-text">
              lostless is a tiny personal navigator. 100% free, no accounts, no API keys, no tracking.
            </p>
            <p className="sb-text mono dim">
              MAP DATA © OPENSTREETMAP CONTRIBUTORS — THE SAME OPEN BASE MAP THAT NESHAN &amp; BALAD BUILD ON.
              TILES: OPENFREEMAP · SEARCH: NOMINATIM · ROUTING: PUBLIC VALHALLA / OSRM.
            </p>
            <p className="sb-text mono dim">
              NAV UI INSPIRED BY NESHAN / BALAD: BIG NEXT-TURN CARD, ETA, SPEED, VOICE.
            </p>
            <p className="sb-text mono dim">VERSION {CONFIG.ui ? '1.0' : '1.0'} · PWA · WORKS OFFLINE FOR CACHED TILES</p>
          </div>
        )}
      </aside>
    </div>
  );
}
