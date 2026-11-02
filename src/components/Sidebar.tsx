import { useState } from 'react';
import { APP_VERSION, type MapStyle } from '../config';
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

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'saved', label: 'Saved' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
];

const STYLE_CHOICES: Array<{ id: MapStyle; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Paper' },
  { id: 'dark', label: 'Night' },
  { id: 'liberty', label: 'Classic' },
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
 * Persian labels, map style), about. Segmented tabs, sentence-case labels.
 */
export function Sidebar(props: SidebarProps) {
  const { open, onClose, theme, onToggleTheme, settings, onSettings, favorites, onPick, onRemoveFav } = props;
  const [tab, setTab] = useState<Tab>('saved');
  if (!open) return null;

  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="sidebar" onClick={(e) => e.stopPropagation()} aria-label="Menu">
        <div className="sb-head">
          <span className="logo">lostless</span>
          <button className="icon-btn sb-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="seg" role="tablist" aria-label="Sidebar sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'saved' && (
          <div className="sb-body">
            <div className="body-label">Saved places · {favorites.length}</div>
            {favorites.length === 0 && (
              <p className="dim sb-empty">
                Nothing saved yet. Tap the star on a place and it lands here.
              </p>
            )}
            <ul className="fav-list">
              {favorites.map((f) => (
                <li key={f.id}>
                  <button className="fav-row" onClick={() => { onPick(f); onClose(); }}>
                    <span className="r-name">{f.name}</span>
                    <span className="r-kind mono">{f.kind ?? 'place'}</span>
                  </button>
                  <button className="icon-btn" onClick={() => onRemoveFav(f.id)} aria-label={`Remove ${f.name.split(',')[0]}`}>×</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'settings' && (
          <div className="sb-body">
            <div className="body-label">Appearance</div>
            <div className="set-row">
              <span className="set-label">Dark mode</span>
              <Toggle on={theme === 'dark'} onClick={onToggleTheme} label="Toggle dark mode" />
            </div>
            <div className="body-label" style={{ marginTop: 16 }}>Map style</div>
            <div className="seg wrap" role="group" aria-label="Map style">
              {STYLE_CHOICES.map((c) => (
                <button key={c.id} className={settings.mapStyle === c.id ? 'active' : ''} onClick={() => set({ mapStyle: c.id })}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="set-row">
              <span className="set-label">Persian place names</span>
              <Toggle on={settings.faLabels} onClick={() => set({ faLabels: !settings.faLabels })} label="Toggle Persian map labels" />
            </div>
            <div className="body-label" style={{ marginTop: 16 }}>Navigation</div>
            <div className="set-row">
              <span className="set-label">Voice{speechSupported() ? '' : ' (not supported here)'}</span>
              <Toggle on={settings.voice && speechSupported()} onClick={() => set({ voice: !settings.voice })} label="Toggle voice guidance" />
            </div>
            <div className="set-row">
              <span className="set-label">Lite mode</span>
              <Toggle on={settings.perf} onClick={() => set({ perf: !settings.perf })} label="Toggle lite mode" />
            </div>
            <p className="dim sb-note">
              Lite mode draws a simpler map and drops the blur. It runs better on older phones.
            </p>
          </div>
        )}

        {tab === 'about' && (
          <div className="sb-body">
            <div className="body-label">About</div>
            <p className="sb-text">
              A small map for getting from one place to another. No account, no key, no tracking.
            </p>
            <p className="sb-text dim">
              Maps come from OpenStreetMap, tiles from OpenFreeMap, routes from Valhalla and OSRM.
              All of them are free and public.
            </p>
            <p className="sb-text dim">
              Built for one hand and a car mount: next turn, time left, speed, voice.
            </p>
            <p className="sb-text dim mono">Version {APP_VERSION} · works offline with saved tiles</p>
          </div>
        )}
      </aside>
    </div>
  );
}
