import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG, type TravelMode } from './config';
import type { Place, RouteResult, Settings, SheetSnap } from './types';
import { useGeolocation } from './hooks/useGeolocation';
import { useTheme } from './hooks/useTheme';
import { useBanners } from './hooks/useBanners';
import { Sheet } from './components/Sheet';
import { TopBar } from './components/TopBar';
import { SearchBox } from './components/SearchBox';
import { RoutePanel } from './components/RoutePanel';
import { StepsList } from './components/StepsList';
import { NavOverlay } from './components/NavOverlay';
import { MapButtons } from './components/MapButtons';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/Sidebar';
import type { MapApi, MapRenderer, MapStatus } from './components/MapView';
import { searchPlaces, reverseGeocode } from './lib/geocode';
import { getRoute } from './lib/routing';
import { nearestOnPolyline, formatCoord, formatDistance, haversineM } from './lib/geo';
import { computeNavProgress } from './lib/navmath';
import { maneuverLabel } from './lib/maneuvers';
import { getFavorites, isFavorite, addFavorite, removeFavorite, getSettings, setSettings as persistSettings } from './lib/storage';
import { acquireWakeLock, releaseWakeLock, reacquireOnVisible, wakeLockSupported } from './lib/wakelock';
import { weakHardware } from './lib/perf';
import { speak, cancelSpeech } from './lib/voice';

// MapLibre (~1.2 MB) loads in its own chunk, after the UI is already interactive
const MapView = lazy(() => import('./components/MapView').then((m) => ({ default: m.MapView })));

type RouteStatus = 'idle' | 'loading' | 'ok' | 'error';
type SearchStatus = 'idle' | 'loading' | 'error';

interface NavState {
  stepIndex: number;
  distToNextM: number;
  remainingM: number;
  remainingS: number;
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { banners, pushBanner, dismissBanner, clearTags } = useBanners();

  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<TravelMode>('car');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle');
  const [navigating, setNavigating] = useState(false);
  const [follow, setFollow] = useState(true);
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [favorites, setFavorites] = useState<Place[]>(() => getFavorites());
  const [nav, setNav] = useState<NavState | null>(null);
  const [remainingCoords, setRemainingCoords] = useState<[number, number][] | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [mapRenderer, setMapRenderer] = useState<MapRenderer>('gl');
  const [mapKey, setMapKey] = useState(0); // bump to re-mount the map (retry)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // while navigating: no smoothing — the raw max-precision fix is shown
  // (snapped onto the route line), so position is exact
  const geo = useGeolocation(!navigating);
  // per-device settings; lite mode auto-on for weak hardware unless the user chose explicitly
  const [settings, setSettingsState] = useState<Settings>(() => {
    const s = getSettings();
    let stored = false;
    try {
      stored = localStorage.getItem(CONFIG.storageKeys.settings) !== null;
    } catch {
      stored = false;
    }
    return { ...s, perf: stored ? s.perf : CONFIG.ui.perfAutoDetect && weakHardware() };
  });
  const [displayPos, setDisplayPos] = useState<GeolocationPosition | null>(null); // dot position (snapped to route while navigating)
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const autoRasterTried = useRef(false);
  const prevFix = useRef<{ ll: [number, number]; t: number } | null>(null);
  const forceRaster = settings.perf;

  const updateSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    persistSettings(s);
  }, []);

  // refs for use inside callbacks/effects without re-subscribing
  const mapApi = useRef<MapApi | null>(null);
  const posRef = useRef<GeolocationPosition | null>(null);
  posRef.current = geo.pos;
  const destRef = useRef<Place | null>(null);
  destRef.current = destination;
  const modeRef = useRef<TravelMode>(mode);
  modeRef.current = mode;
  const navigatingRef = useRef(navigating);
  navigatingRef.current = navigating;
  const routeReqId = useRef(0);
  const offRouteCount = useRef(0);
  const wasGpsOk = useRef(false);

  // ── online / offline ───────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (online) {
      clearTags('net');
    } else {
      pushBanner('error', 'You are offline — cached tiles only, routing and search unavailable', { tag: 'net', sticky: true });
    }
  }, [online, pushBanner, clearTags]);

  // ── GPS status banners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (geo.status === 'denied') {
      pushBanner('error', 'Location permission denied — allow location for this site in the browser, then retry', {
        tag: 'gps',
        sticky: true,
        action: { label: 'Retry', onClick: geo.retry },
      });
    } else if (geo.status === 'error') {
      pushBanner('error', 'GPS signal lost — retrying automatically', {
        tag: 'gps',
        sticky: true,
        action: { label: 'Retry', onClick: geo.retry },
      });
    } else if (geo.status === 'unsupported') {
      pushBanner('error', 'Geolocation is not supported by this browser — routes start from the map center', { tag: 'gps', sticky: true });
    } else if (geo.status === 'locating') {
      // no fix yet — after a while, tell the user what might be wrong
      const t = setTimeout(() => {
        pushBanner('info', 'GPS still searching… turn on location (high accuracy) and try outdoors', { tag: 'gps-slow' });
      }, 10000);
      return () => clearTimeout(t);
    } else {
      clearTags('gps', 'gps-slow');
    }
  }, [geo.status, geo.retry, pushBanner, clearTags]);

  // ── routing ────────────────────────────────────────────────────────────────
  const fetchRoute = useCallback(
    async (dest: Place, m: TravelMode) => {
      const reqId = ++routeReqId.current;
      setRouteStatus('loading');
      const origin: [number, number] = posRef.current
        ? [posRef.current.coords.longitude, posRef.current.coords.latitude]
        : (mapApi.current?.getCenter() ?? CONFIG.map.initialCenter);
      try {
        const r = await getRoute(m, origin, [dest.lon, dest.lat]);
        if (reqId !== routeReqId.current) return; // a newer request superseded this one
        setRoute(r);
        setRouteStatus('ok');
        setNav(null);
        setRemainingCoords(null);
      } catch (err) {
        if (reqId !== routeReqId.current) return;
        setRoute(null);
        setRouteStatus('error');
        pushBanner(
          'error',
          navigator.onLine
            ? 'ROUTING SERVER UNREACHABLE OR NO ROUTE — RETRY, OR SWITCH SERVER IN src/config.ts'
            : 'OFFLINE — CANNOT CALCULATE ROUTE',
          {
            tag: 'route',
            sticky: true, // stays until fixed — it carries a RETRY action
            action: {
              label: 'Retry',
              onClick: () => {
                if (destRef.current) void fetchRoute(destRef.current, modeRef.current);
              },
            },
          },
        );
        void err;
      }
    },
    [pushBanner],
  );

  // (re)calculate when destination or mode changes
  useEffect(() => {
    if (destination) void fetchRoute(destination, mode);
  }, [destination, mode, fetchRoute]);

  // when GPS first locks: fly to the user, and redo the route from the real position
  useEffect(() => {
    if (geo.status === 'ok' && !wasGpsOk.current) {
      if (posRef.current) {
        const { longitude, latitude } = posRef.current.coords;
        if (!navigatingRef.current) mapApi.current?.centerOn([longitude, latitude], 15.5);
      }
      if (destRef.current && !navigatingRef.current) void fetchRoute(destRef.current, modeRef.current);
    }
    wasGpsOk.current = geo.status === 'ok';
  }, [geo.status, fetchRoute]);

  // ── search ─────────────────────────────────────────────────────────────────
  const onSearchRef = useRef<() => void>(() => {});
  const onSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || searchStatus === 'loading') return;
    setSearchStatus('loading');
    try {
      const r = await searchPlaces(q);
      setResults(r);
      setSearchStatus('idle');
      if (r.length > 0) setSnap('full');
      else pushBanner('info', 'No results — try another name or a city');
    } catch {
      setResults([]);
      setSearchStatus('error');
      pushBanner('error', 'Search failed — Nominatim unreachable (or offline)', {
        tag: 'search',
        sticky: true,
        action: { label: 'Retry', onClick: () => void onSearchRef.current() },
      });
    }
  }, [query, searchStatus, pushBanner]);
  onSearchRef.current = onSearch;

  const pickPlace = useCallback((p: Place) => {
    setDestination(p);
    setResults([]);
    setQuery('');
    setSnap('peek');
  }, []);

  // ── map tap → drop pin ─────────────────────────────────────────────────────
  const onMapTap = useCallback(
    async (ll: [number, number]) => {
      setSnap('peek');
      const name = await reverseGeocode(ll[1], ll[0]);
      pickPlace({ id: `pin:${ll[1].toFixed(6)},${ll[0].toFixed(6)}`, name, lat: ll[1], lon: ll[0], kind: 'pin' });
    },
    [pickPlace],
  );

  // ── navigation ─────────────────────────────────────────────────────────────
  const lastSpokenStep = useRef(-1);
  const startNav = useCallback(() => {
    setNavigating(true);
    setFollow(true);
    setSnap('hidden'); // navigation mode: map gets the whole screen
    lastSpokenStep.current = -1; // speak the first maneuver again on (re)start
    offRouteCount.current = 0;
    if (settings.voice) speak('Navigation started');
  }, [settings.voice]);

  const stopNav = useCallback(() => {
    setNavigating(false);
    setNav(null);
    setRemainingCoords(null);
    setDisplayPos(null);
    setSpeedKmh(null);
    cancelSpeech();
  }, []);

  // voice guidance: speak the next maneuver whenever the step changes
  useEffect(() => {
    if (!navigating || !nav || !route || !settings.voice) return;
    if (nav.stepIndex === lastSpokenStep.current) return;
    lastSpokenStep.current = nav.stepIndex;
    const step = route.steps[nav.stepIndex];
    if (!step) return;
    const label = maneuverLabel(step);
    const dist = formatDistance(nav.distToNextM);
    speak(`In ${dist}, ${label}${step.street ? ` onto ${step.street}` : ''}`.replace(/\s+/g, ' ').trim());
  }, [navigating, nav, route, settings.voice]);

  useEffect(() => () => cancelSpeech(), []);

  const clearDestination = useCallback(() => {
    stopNav();
    setDestination(null);
    setRoute(null);
    setRouteStatus('idle');
  }, [stopNav]);

  // wake lock while navigating
  useEffect(() => {
    if (!navigating) return;
    let removeListener = () => {};
    void acquireWakeLock().then((ok) => {
      if (!ok && !wakeLockSupported()) {
        pushBanner('info', 'Screen wake lock is not supported here — the screen may sleep while navigating');
      }
      removeListener = reacquireOnVisible();
    });
    return () => {
      removeListener();
      void releaseWakeLock();
    };
  }, [navigating, pushBanner]);

  // live position → progress along route, off-route detection, remaining polyline,
  // snapped dot position + speed readout
  useEffect(() => {
    if (!navigating || !route || !geo.pos) return;
    const p: [number, number] = [geo.pos.coords.longitude, geo.pos.coords.latitude];
    const near = nearestOnPolyline(route.coords, p);

    // snap the dot onto the route when we're close to it (smoother tracking);
    // tighter while navigating for max precision
    const snapM = navigating ? 25 : 40;
    if (near.distM < snapM) {
      setDisplayPos({ ...geo.pos, coords: { ...geo.pos.coords, longitude: near.point[0], latitude: near.point[1] } });
    } else {
      setDisplayPos(null);
    }

    // speed: GPS-reported, else derived from consecutive fixes (never NaN)
    const sp = geo.pos.coords.speed;
    if (sp !== null && Number.isFinite(sp)) {
      setSpeedKmh(sp * 3.6);
      prevFix.current = null;
    } else {
      const prev = prevFix.current;
      const now = geo.pos.timestamp || Date.now();
      if (prev && now > prev.t) {
        const d = haversineM(prev.ll, p);
        const dt = (now - prev.t) / 1000;
        if (Number.isFinite(d) && dt > 0.5 && dt < 30) setSpeedKmh((d / dt) * 3.6);
      }
      prevFix.current = { ll: p, t: now };
    }

    setRemainingCoords([near.point, ...route.coords.slice(near.segmentIndex + 1)]);

    // progress through the steps — pure, unit-tested math (lib/navmath)
    const prog = computeNavProgress(route, near.arclengthM);
    setNav({
      stepIndex: prog.stepIndex,
      distToNextM: prog.distToNextM,
      remainingM: prog.remainingM,
      remainingS: prog.remainingS,
    });

    if (near.distM > CONFIG.reroute.thresholdM) {
      offRouteCount.current += 1;
      if (offRouteCount.current >= CONFIG.reroute.consecutiveFixes && destRef.current) {
        offRouteCount.current = 0;
        pushBanner('info', 'Off route — rerouting…');
        void fetchRoute(destRef.current, modeRef.current);
      }
    } else {
      offRouteCount.current = 0;
    }
  }, [geo.pos, navigating, route, fetchRoute, pushBanner]);

  // ── favorites ──────────────────────────────────────────────────────────────
  const toggleFav = useCallback((p: Place) => {
    setFavorites(isFavorite(p.id) ? removeFavorite(p.id) : addFavorite(p));
  }, []);

  const recenter = useCallback(() => {
    const pos = posRef.current;
    if (pos) {
      mapApi.current?.centerOn([pos.coords.longitude, pos.coords.latitude], CONFIG.map.navigationZoom);
      setFollow(true);
    } else {
      // no fix yet: nothing to center on — arm follow mode so the map snaps to
      // the user as soon as the first fix arrives
      setFollow(true);
      pushBanner('info', 'No GPS fix yet — follow armed, map centers when GPS locks', { tag: 'recenter' });
    }
  }, [pushBanner]);

  const onMapStatus = useCallback(
    (s: MapStatus, msg?: string, renderer?: MapRenderer) => {
      if (renderer) setMapRenderer(renderer);
      setMapStatus(s);
      if (s === 'error') {
        // the GL map failed (blank) — fall back to the raster map automatically, once
        if (!forceRaster && !autoRasterTried.current) {
          autoRasterTried.current = true;
          updateSettings({ ...settings, perf: true });
          setMapStatus('loading');
          setMapKey((k) => k + 1);
          pushBanner('info', `Map rendering unavailable (${msg ?? 'unknown'}) — switched to the lite raster map`, {
            tag: 'map',
            sticky: true,
            action: {
              label: 'Retry',
              onClick: () => {
                autoRasterTried.current = false;
                updateSettings({ ...settings, perf: false });
                setMapStatus('loading');
                setMapKey((k) => k + 1);
              },
            },
          });
          return;
        }
        pushBanner('error', `Map failed to load (${msg ?? 'unknown'}) — check connection or WebGL`, {
          tag: 'map',
          sticky: true,
          action: {
            label: 'Retry',
            onClick: () => {
              setMapStatus('loading');
              setMapKey((k) => k + 1);
            },
          },
          action2: {
            label: 'USE RASTER MAP',
            onClick: () => {
              updateSettings({ ...settings, perf: true });
              setMapStatus('loading');
              setMapKey((k) => k + 1);
            },
          },
        });
      } else {
        clearTags('map');
      }
    },
    [pushBanner, clearTags, forceRaster, settings, updateSettings],
  );

  // ── render ─────────────────────────────────────────────────────────────────
  const shortName = (name: string) => name.split(',')[0];

  const peekContent = (
    <>
      <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchStatus === 'loading'} />
      {destination ? (
        <RoutePanel
          destination={destination}
          route={route}
          routeStatus={routeStatus === 'idle' ? 'loading' : routeStatus}
          mode={mode}
          onMode={setMode}
          navigating={navigating}
          onStart={startNav}
          onStop={stopNav}
          onClear={clearDestination}
          onRetry={() => void fetchRoute(destination, mode)}
          isFav={isFavorite(destination.id)}
          onToggleFav={() => toggleFav(destination)}
        />
      ) : (
        <div className="hint-panel">
          <p className="dim">
            Tap the map to drop a pin, or search for a place above.
          </p>
          {favorites.length > 0 && (
            <div className="fav-chips">
              {favorites.map((f) => (
                <button key={f.id} className="chip" onClick={() => pickPlace(f)}>
                  {shortName(f.name)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  const bodyContent = (
    <>
      {searchStatus === 'loading' && <div className="body-note dim">Searching…</div>}
      {searchStatus === 'error' && <div className="body-note err">Search failed — check your connection.</div>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => pickPlace(r)}>
                <span className="r-name">{r.name}</span>
                <span className="r-kind mono">{r.kind ?? 'place'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.length === 0 && route && routeStatus === 'ok' && (
        <>
          <div className="body-label">Turn-by-turn · {route.steps.length} steps</div>
          <StepsList steps={route.steps} current={navigating && nav ? nav.stepIndex : null} />
        </>
      )}
      {results.length === 0 && !route && (
        <>
          {favorites.length > 0 && (
            <>
              <div className="body-label">Saved places · {favorites.length}</div>
              <ul className="fav-list">
                {favorites.map((f) => (
                  <li key={f.id}>
                    <button className="fav-row" onClick={() => pickPlace(f)}>
                      <span className="r-name">{f.name}</span>
                      <span className="r-kind mono">{formatCoord(f.lat, f.lon)}</span>
                    </button>
                    <button className="icon-btn" onClick={() => setFavorites(removeFavorite(f.id))} aria-label={`Remove ${shortName(f.name)}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="body-label dim footer-note">
            Map data © OpenStreetMap contributors · tiles OpenFreeMap (fallback: OSM raster) · routing Valhalla/OSRM — all free public services.
          </div>
        </>
      )}
    </>
  );

  return (
    <div className={`app${settings.perf ? ' perf' : ''}`}>
      <div className="map-wrap">
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="map-container map-loading">
                <span>
                  Loading map<span className="dots">…</span>
                </span>
              </div>
            }
          >
            <MapView
              key={mapKey}
              theme={theme}
              mapStyle={settings.mapStyle}
              pos={geo.pos}
              displayPos={displayPos}
              destination={destination}
              route={route}
              remainingCoords={navigating ? remainingCoords : null}
              navigating={navigating}
              follow={follow}
              forceRaster={forceRaster}
              perf={settings.perf}
              faLabels={settings.faLabels}
              onMapTap={onMapTap}
              onMapReady={(api) => {
                mapApi.current = api;
              }}
              onStatus={onMapStatus}
            />
          </Suspense>
        </ErrorBoundary>

        <TopBar
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSidebar={() => setSidebarOpen(true)}
          gpsStatus={geo.status}
          onGpsRetry={geo.retry}
          online={online}
          coords={geo.pos ? geo.pos.coords : null}
        />

        <div className="banners">
          {banners.map((b) => (
            <div key={b.id} className={`banner ${b.kind}`} role={b.kind === 'error' ? 'alert' : 'status'}>
              <span className="b-msg">{b.msg}</span>
              {b.action && (
                <button className="mini-btn" onClick={b.action.onClick}>
                  {b.action.label}
                </button>
              )}
              {b.action2 && (
                <button className="mini-btn" onClick={b.action2.onClick}>
                  {b.action2.label}
                </button>
              )}
              <button className="icon-btn b-x" onClick={() => dismissBanner(b.id)} aria-label="dismiss">
                ×
              </button>
            </div>
          ))}
        </div>

        {navigating && nav && route && (
          <NavOverlay
            step={route.steps[nav.stepIndex]}
            distToNextM={nav.distToNextM}
            remainingM={nav.remainingM}
            remainingS={nav.remainingS}
            speedKmh={speedKmh}
            progress={route.distanceM > 0 ? 1 - nav.remainingM / route.distanceM : 0}
            mode={mode}
            onStop={stopNav}
          />
        )}

        <div className={`map-status${mapStatus === 'error' ? ' err' : ''}`}>
          Map · <span className="mono">{mapStatus === 'ready' ? (mapRenderer === 'raster' ? 'raster' : 'vector') : mapStatus === 'loading' ? 'loading…' : 'error — see banner'}</span>
        </div>

        <MapButtons
          follow={follow}
          navigating={navigating}
          onZoomIn={() => mapApi.current?.zoomBy(1)}
          onZoomOut={() => mapApi.current?.zoomBy(-1)}
          onRecenter={recenter}
        />

        {snap === 'hidden' && (
          <button className="fab" onClick={() => setSnap('peek')}>
            Search
          </button>
        )}
      </div>

      <Sheet snap={snap} onSnap={setSnap} peek={peekContent} body={bodyContent} />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        settings={settings}
        onSettings={updateSettings}
        favorites={favorites}
        onPick={pickPlace}
        onRemoveFav={(id) => setFavorites(removeFavorite(id))}
      />
    </div>
  );
}
