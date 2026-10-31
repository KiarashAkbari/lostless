import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG, type TravelMode } from './config';
import type { Banner, Place, RouteResult, SheetSnap } from './types';
import { useGeolocation } from './hooks/useGeolocation';
import { useTheme } from './hooks/useTheme';
import { MapView, type MapApi } from './components/MapView';
import { Sheet } from './components/Sheet';
import { TopBar } from './components/TopBar';
import { SearchBox } from './components/SearchBox';
import { RoutePanel } from './components/RoutePanel';
import { StepsList } from './components/StepsList';
import { NavOverlay } from './components/NavOverlay';
import { MapButtons } from './components/MapButtons';
import { searchPlaces, reverseGeocode } from './lib/geocode';
import { getRoute } from './lib/routing';
import { nearestOnPolyline, formatCoord } from './lib/geo';
import { getFavorites, isFavorite, addFavorite, removeFavorite } from './lib/storage';
import { acquireWakeLock, releaseWakeLock, reacquireOnVisible, wakeLockSupported } from './lib/wakelock';

type RouteStatus = 'idle' | 'loading' | 'ok' | 'error';
type SearchStatus = 'idle' | 'loading' | 'error';

interface NavState {
  stepIndex: number;
  distToNextM: number;
  remainingM: number;
  remainingS: number;
}

let bannerSeq = 0;

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const geo = useGeolocation();

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
  const [banners, setBanners] = useState<Banner[]>([]);
  const [nav, setNav] = useState<NavState | null>(null);
  const [remainingCoords, setRemainingCoords] = useState<[number, number][] | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);

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

  // ── banners ────────────────────────────────────────────────────────────────
  const dismissBanner = useCallback((id: number) => {
    setBanners((b) => b.filter((x) => x.id !== id));
  }, []);

  const pushBanner = useCallback(
    (kind: Banner['kind'], msg: string, opts?: { tag?: string; sticky?: boolean; action?: { label: string; onClick: () => void } }) => {
      const id = ++bannerSeq;
      if (opts?.tag) setBanners((b) => [...b.filter((x) => x.tag !== opts.tag), { id, kind, msg, tag: opts.tag, action: opts?.action }]);
      else setBanners((b) => [...b, { id, kind, msg, action: opts?.action }]);
      if (!opts?.sticky) setTimeout(() => dismissBanner(id), 6500);
    },
    [dismissBanner],
  );

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
      setBanners((b) => b.filter((x) => x.tag !== 'net'));
    } else {
      pushBanner('error', 'YOU ARE OFFLINE — CACHED TILES ONLY, ROUTING/SEARCH UNAVAILABLE', { tag: 'net', sticky: true });
    }
  }, [online, pushBanner]);

  // ── GPS status banners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (geo.status === 'denied') {
      pushBanner('error', 'GPS PERMISSION DENIED — ALLOW LOCATION FOR THIS SITE IN THE BROWSER, THEN RETRY', {
        tag: 'gps',
        sticky: true,
        action: { label: 'RETRY', onClick: geo.retry },
      });
    } else if (geo.status === 'error') {
      pushBanner('error', 'GPS SIGNAL LOST — RETRYING AUTOMATICALLY', {
        tag: 'gps',
        sticky: true,
        action: { label: 'RETRY', onClick: geo.retry },
      });
    } else if (geo.status === 'unsupported') {
      pushBanner('error', 'GEOLOCATION NOT SUPPORTED BY THIS BROWSER — ROUTES START FROM MAP CENTER', { tag: 'gps', sticky: true });
    } else {
      setBanners((b) => b.filter((x) => x.tag !== 'gps'));
    }
  }, [geo.status, geo.retry, pushBanner]);

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
          { tag: 'route' },
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

  // if a destination was picked before GPS locked, redo the route from the real position
  useEffect(() => {
    if (geo.status === 'ok' && !wasGpsOk.current && destRef.current && !navigatingRef.current) {
      void fetchRoute(destRef.current, modeRef.current);
    }
    wasGpsOk.current = geo.status === 'ok';
  }, [geo.status, fetchRoute]);

  // ── search ─────────────────────────────────────────────────────────────────
  const onSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || searchStatus === 'loading') return;
    setSearchStatus('loading');
    try {
      const r = await searchPlaces(q);
      setResults(r);
      setSearchStatus('idle');
      if (r.length > 0) setSnap('full');
      else pushBanner('info', 'NO RESULTS — TRY ANOTHER NAME OR A CITY');
    } catch {
      setResults([]);
      setSearchStatus('error');
      pushBanner('error', 'SEARCH FAILED — NOMINATIM UNREACHABLE (OR OFFLINE)', { tag: 'search' });
    }
  }, [query, searchStatus, pushBanner]);

  const pickPlace = useCallback((p: Place) => {
    setDestination(p);
    setResults([]);
    setQuery('');
    setSnap('peek');
  }, []);

  // ── map tap → drop pin ─────────────────────────────────────────────────────
  const onMapTap = useCallback(async (ll: [number, number]) => {
    setSnap('peek');
    const name = await reverseGeocode(ll[1], ll[0]);
    pickPlace({ id: `pin:${ll[1].toFixed(6)},${ll[0].toFixed(6)}`, name, lat: ll[1], lon: ll[0], kind: 'pin' });
  }, [pickPlace]);

  // ── navigation ─────────────────────────────────────────────────────────────
  const startNav = useCallback(() => {
    setNavigating(true);
    setFollow(true);
    setSnap('peek');
  }, []);

  const stopNav = useCallback(() => {
    setNavigating(false);
    setNav(null);
    setRemainingCoords(null);
  }, []);

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
      if (!ok && wakeLockSupported() === false) {
        pushBanner('info', 'SCREEN WAKE LOCK NOT SUPPORTED HERE — THE SCREEN MAY SLEEP WHILE NAVIGATING');
      }
      removeListener = reacquireOnVisible();
    });
    return () => {
      removeListener();
      void releaseWakeLock();
    };
  }, [navigating, pushBanner]);

  // live position → progress along route, off-route detection, remaining polyline
  useEffect(() => {
    if (!navigating || !route || !geo.pos) return;
    const p: [number, number] = [geo.pos.coords.longitude, geo.pos.coords.latitude];
    const near = nearestOnPolyline(route.coords, p);

    setRemainingCoords([near.point, ...route.coords.slice(near.segmentIndex + 1)]);

    let acc = 0;
    let idx = 0;
    for (let i = 0; i < route.steps.length; i++) {
      acc += route.steps[i].distanceM;
      idx = i;
      if (acc >= near.arclengthM) break;
    }
    const stepEnd = route.steps.slice(0, idx + 1).reduce((s, x) => s + x.distanceM, 0);
    const remainingM = Math.max(0, route.distanceM - near.arclengthM);
    setNav({
      stepIndex: idx,
      distToNextM: Math.max(0, stepEnd - near.arclengthM),
      remainingM,
      remainingS: route.distanceM > 0 ? route.durationS * (remainingM / route.distanceM) : 0,
    });

    if (near.distM > CONFIG.reroute.thresholdM) {
      offRouteCount.current += 1;
      if (offRouteCount.current >= CONFIG.reroute.consecutiveFixes && destRef.current) {
        offRouteCount.current = 0;
        pushBanner('info', 'OFF ROUTE — REROUTING…');
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
      setFollow((f) => !f);
    }
  }, []);

  // ── render ─────────────────────────────────────────────────────────────────
  const shortName = (name: string) => name.split(',')[0];

  const peekContent = (
    <>
      <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchStatus === 'loading'} />
      {destination && route ? (
        <RoutePanel
          destination={destination}
          route={route}
          routeStatus={routeStatus}
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
      ) : destination ? (
        <RoutePanel
          destination={destination}
          route={null}
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
          <p className="mono dim">
            TAP THE MAP TO DROP A PIN
            <br />
            OR SEARCH ABOVE + ENTER
          </p>
          {favorites.length > 0 && (
            <div className="fav-chips">
              {favorites.map((f) => (
                <button key={f.id} className="chip mono" onClick={() => pickPlace(f)}>
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
      {searchStatus === 'loading' && <div className="body-note mono dim">SEARCHING…</div>}
      {searchStatus === 'error' && <div className="body-note mono err">SEARCH FAILED — CHECK CONNECTION</div>}
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
          <div className="body-label mono dim">TURN-BY-TURN // {route.steps.length} STEPS</div>
          <StepsList steps={route.steps} current={navigating && nav ? nav.stepIndex : null} />
        </>
      )}
      {results.length === 0 && !route && (
        <>
          {favorites.length > 0 && (
            <>
              <div className="body-label mono dim">SAVED PLACES // {favorites.length}</div>
              <ul className="fav-list">
                {favorites.map((f) => (
                  <li key={f.id}>
                    <button className="fav-row" onClick={() => pickPlace(f)}>
                      <span className="r-name">{f.name}</span>
                      <span className="r-kind mono">{formatCoord(f.lat, f.lon)}</span>
                    </button>
                    <button className="icon-btn mono" onClick={() => setFavorites(removeFavorite(f.id))} aria-label={`remove ${shortName(f.name)}`}>×</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="body-label mono dim footer-note">
            MAP DATA © OPENSTREETMAP CONTRIBUTORS · TILES OPENFREEMAP · ROUTING VALHALLA/OSRM — ALL FREE PUBLIC SERVICES
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="app">
      <div className="map-wrap">
        <MapView
          theme={theme}
          pos={geo.pos}
          destination={destination}
          route={route}
          remainingCoords={navigating ? remainingCoords : null}
          navigating={navigating}
          follow={follow}
          onMapTap={onMapTap}
          onMapReady={(api) => {
            mapApi.current = api;
          }}
        />

        <TopBar
          theme={theme}
          onToggleTheme={toggleTheme}
          gpsStatus={geo.status}
          onGpsRetry={geo.retry}
          online={online}
          coords={geo.pos ? geo.pos.coords : null}
        />

        <div className="banners">
          {banners.map((b) => (
            <div key={b.id} className={`banner mono ${b.kind}`}>
              <span className="b-msg">{b.msg}</span>
              {b.action && (
                <button className="mini-btn mono" onClick={b.action.onClick}>
                  {b.action.label}
                </button>
              )}
              <button className="icon-btn mono b-x" onClick={() => dismissBanner(b.id)} aria-label="dismiss">×</button>
            </div>
          ))}
        </div>

        {navigating && nav && route && (
          <NavOverlay
            step={route.steps[nav.stepIndex]}
            distToNextM={nav.distToNextM}
            remainingM={nav.remainingM}
            remainingS={nav.remainingS}
          />
        )}

        <MapButtons
          follow={follow}
          navigating={navigating}
          onZoomIn={() => mapApi.current?.zoomBy(1)}
          onZoomOut={() => mapApi.current?.zoomBy(-1)}
          onRecenter={recenter}
        />

        <Sheet snap={snap} onSnap={setSnap} peek={peekContent} body={bodyContent} />

        {snap === 'hidden' && (
          <button className="fab mono" onClick={() => setSnap('peek')}>
            + SEARCH
          </button>
        )}
      </div>
    </div>
  );
}
