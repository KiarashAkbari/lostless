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
import type { MapApi, MapStatus } from './components/MapView';
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
  const [emptySearch, setEmptySearch] = useState(''); // last query that found nothing
  const [favorites, setFavorites] = useState<Place[]>(() => getFavorites());
  const [nav, setNav] = useState<NavState | null>(null);
  const [remainingCoords, setRemainingCoords] = useState<[number, number][] | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
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
  const lastArclength = useRef(-Infinity);
  const lastStepIndex = useRef(-1);
  const wasGpsOk = useRef(false);

  // Escape: close the drawer first, then clear a results list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sidebarOpen) setSidebarOpen(false);
      else if (results.length > 0) setResults([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen, results.length]);

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
      pushBanner('error', "You're offline. Cached tiles still show, but search and routing are paused.", { tag: 'net', sticky: true });
    }
  }, [online, pushBanner, clearTags]);

  // ── GPS status banners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (geo.status === 'denied') {
      pushBanner('error', 'Location is blocked. Allow it for this site in your browser settings, then try again.', {
        tag: 'gps',
        sticky: true,
        action: { label: 'Try again', onClick: geo.retry },
      });
    } else if (geo.status === 'error') {
      pushBanner('error', 'Lost the GPS signal. Reconnecting…', {
        tag: 'gps',
        sticky: true,
        action: { label: 'Try again', onClick: geo.retry },
      });
    } else if (geo.status === 'unsupported') {
      pushBanner('error', "This browser can't share your location. Routes will start from the middle of the map.", { tag: 'gps', sticky: true });
    } else if (geo.status === 'locating') {
      // no fix yet — after a while, tell the user what might be wrong
      const t = setTimeout(() => {
        pushBanner('info', 'Still looking for a fix. It helps to be outside or near a window.', { tag: 'gps-slow' });
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
        // show the whole route, but never yank the camera mid-navigation
        if (!navigatingRef.current) mapApi.current?.fitRoute(r.coords);
      } catch (err) {
        if (reqId !== routeReqId.current) return;
        setRoute(null);
        setRouteStatus('error');
        pushBanner(
          'error',
          navigator.onLine
            ? "No route came back. The routing server may be busy, so try again in a moment."
            : "You're offline, so a route can't be calculated right now.",
          {
            tag: 'route',
            sticky: true, // stays until fixed - it carries a retry action
            action: {
              label: 'Try again',
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

  // (re)calculate only when the *place* or the mode changes. The destination
  // object itself is replaced when a dropped pin gets its street name back —
  // that must not trigger a second routing request.
  const destKey = destination ? `${destination.lat},${destination.lon}` : '';
  useEffect(() => {
    const d = destRef.current;
    if (d) void fetchRoute(d, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey, mode, fetchRoute]);

  // when GPS first locks: fly to the user, and redo the route from the real position
  useEffect(() => {
    if (geo.status === 'ok' && !wasGpsOk.current) {
      if (posRef.current) {
        const { longitude, latitude } = posRef.current.coords;
        // only jump to the user when there is nothing else on screen to look at
        if (!navigatingRef.current && !destRef.current) mapApi.current?.centerOn([longitude, latitude], 15.5);
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
      setEmptySearch(r.length === 0 ? q : '');
      if (r.length > 0) setSnap('full');
    } catch {
      setResults([]);
      setSearchStatus('error');
      pushBanner('error', "Search isn't answering. Check your connection and try again.", {
        tag: 'search',
        sticky: true,
        action: { label: 'Try again', onClick: () => void onSearchRef.current() },
      });
    }
  }, [query, searchStatus, pushBanner]);
  onSearchRef.current = onSearch;

  const pickPlace = useCallback((p: Place) => {
    setDestination(p);
    setResults([]);
    setEmptySearch('');
    setQuery('');
    setSnap('peek');
    if (!navigatingRef.current && Number.isFinite(p.lon) && Number.isFinite(p.lat)) {
      mapApi.current?.centerOn([p.lon, p.lat], CONFIG.map.pickZoom);
    }
  }, []);

  // ── map tap → drop pin ─────────────────────────────────────────────────────
  const tapReqId = useRef(0);
  const onMapTap = useCallback(
    (ll: [number, number]) => {
      // tapping the map mid-drive would silently change the destination and
      // cancel navigation — that has to be an explicit action instead
      if (navigatingRef.current) {
        pushBanner('info', 'You are navigating. Stop first to pick a new destination.');
        return;
      }
      if (!Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return;
      const id = `pin:${ll[1].toFixed(6)},${ll[0].toFixed(6)}`;
      const fallback = `${formatCoord(ll[1], ll[0])}`;
      // pin lands immediately with the coordinates; the street name is a
      // nicety that arrives (or doesn't) afterwards. Never a dead tap.
      pickPlace({ id, name: fallback, lat: ll[1], lon: ll[0], kind: 'pin' });
      const reqId = ++tapReqId.current;
      void reverseGeocode(ll[1], ll[0])
        .then((name) => {
          if (reqId !== tapReqId.current || !name) return;
          setDestination((d) => (d && d.id === id ? { ...d, name } : d));
        })
        .catch(() => {
          /* keep the coordinate name — the route still works */
        });
    },
    [pickPlace, pushBanner],
  );

  // ── navigation ─────────────────────────────────────────────────────────────
  const lastSpokenStep = useRef(-1);
  const startNav = useCallback(() => {
    setNavigating(true);
    setFollow(true);
    lastArclength.current = -Infinity;
    lastStepIndex.current = -1;
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
    setSnap('peek'); // the trip is over: bring the route card back
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
        pushBanner('info', 'Your screen may turn off while you navigate.');
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

    // snap the dot onto the route when we're close to it — 25 m keeps the
    // arrow on the road instead of drifting between fixes
    if (near.distM < CONFIG.map.snapToRouteM) {
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

    // progress through the steps — pure, unit-tested math (lib/navmath)
    const prog = computeNavProgress(route, near.arclengthM);
    // push a new polyline / card only when something visible moved: re-uploading
    // the route geometry on every 1 Hz fix is wasted work while driving
    const advanced = Math.abs(near.arclengthM - lastArclength.current) >= 5;
    if (advanced || prog.stepIndex !== lastStepIndex.current) {
      lastArclength.current = near.arclengthM;
      lastStepIndex.current = prog.stepIndex;
      setRemainingCoords([near.point, ...route.coords.slice(near.segmentIndex + 1)]);
      setNav({
        stepIndex: prog.stepIndex,
        distToNextM: prog.distToNextM,
        remainingM: prog.remainingM,
        remainingS: prog.remainingS,
      });
    }

    if (near.distM > CONFIG.reroute.thresholdM) {
      offRouteCount.current += 1;
      if (offRouteCount.current >= CONFIG.reroute.consecutiveFixes && destRef.current) {
        offRouteCount.current = 0;
        pushBanner('info', 'Off the route. Finding a new one…');
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
      // keep the zoom the user chose while browsing; only zoom in for driving
      mapApi.current?.centerOn([pos.coords.longitude, pos.coords.latitude], navigatingRef.current ? CONFIG.map.navigationZoom : undefined);
      setFollow(true);
    } else {
      // no fix yet: nothing to center on — arm follow mode so the map snaps to
      // the user as soon as the first fix arrives
      setFollow(true);
      pushBanner('info', 'No fix yet. The map will jump to you as soon as there is one.', { tag: 'recenter' });
    }
  }, [pushBanner]);

  const onMapStatus = useCallback(
    (s: MapStatus, msg?: string) => {
      if (s === 'error') {
        // the GL map failed (blank) — fall back to the raster map automatically, once
        if (!forceRaster && !autoRasterTried.current) {
          autoRasterTried.current = true;
          updateSettings({ ...settings, perf: true });
          setMapKey((k) => k + 1);
          pushBanner('info', `The 3D map isn't available (${msg ?? 'unknown reason'}). Showing the simple map instead.`, {
            tag: 'map',
            sticky: true,
            action: {
              label: 'Try again',
              onClick: () => {
                autoRasterTried.current = false;
                updateSettings({ ...settings, perf: false });
                      setMapKey((k) => k + 1);
              },
            },
          });
          return;
        }
        pushBanner('error', `The map didn't load (${msg ?? 'unknown reason'}). Check your connection and try again.`, {
          tag: 'map',
          sticky: true,
          action: {
            label: 'Try again',
            onClick: () => {
                  setMapKey((k) => k + 1);
            },
          },
          action2: {
            label: 'Use simple map',
            onClick: () => {
              updateSettings({ ...settings, perf: true });
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
            Tap the map to set a destination, or search for a place.
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
      {searchStatus === 'error' && <div className="body-note err">Search isn't answering. Check your connection.</div>}
      {searchStatus === 'idle' && results.length === 0 && emptySearch && (
        <div className="body-note dim">
          Nothing matched “{emptySearch}”. Try a street, a shop or a town.
        </div>
      )}
      {results.length > 0 && (
        <div className="body-head">
          <span className="body-label">Results · {results.length}</span>
          <button
            className="icon-btn"
            onClick={() => { setResults([]); setEmptySearch(''); }}
            aria-label="Clear results"
            title="Clear results"
          >
            ×
          </button>
        </div>
      )}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => pickPlace(r)}>
                <span className="r-name">{r.name}</span>
                <span className="r-kind mono">
                  {geo.pos ? `${formatDistance(haversineM([geo.pos.coords.longitude, geo.pos.coords.latitude], [r.lon, r.lat]))} · ` : ''}
                  {r.kind ?? 'place'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.length === 0 && route && routeStatus === 'ok' && (
        <>
          <div className="body-label">Directions · {route.steps.length} steps</div>
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
            Map data © OpenStreetMap. Tiles by OpenFreeMap. Routing by Valhalla and OSRM.
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

        <MapButtons
          follow={follow}
          navigating={navigating}
          onZoomIn={() => mapApi.current?.zoomBy(1)}
          onZoomOut={() => mapApi.current?.zoomBy(-1)}
          onRecenter={recenter}
        />

        {snap === 'hidden' && !navigating && (
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
