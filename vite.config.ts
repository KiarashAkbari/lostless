import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' so the same build works on GitHub Pages (project site under /<repo>/)
// and on Vercel (served at the domain root).

// Same-origin proxy for the Arena live preview (*.e2b.app): in the preview
// context, requests to third-party origins can be blocked (→ blank map), so
// the app routes all external calls through /proxy/* (see src/config.ts
// svcUrl). vite forwards them here — in BOTH dev and preview mode.
// Targets can be overridden with LOSTLESS_PROXY_<NAME> env vars (local testing
// / self-hosting). `process` is accessed via globalThis because @types/node is
// not installed.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const toUpstream = (name: string, fallback: string) => ({
  target: env[`LOSTLESS_PROXY_${name}`] ?? fallback,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/proxy\/[a-z0-9]+/i, ''),
});
const serviceProxy = {
  '/proxy/ofm': toUpstream('OFM', 'https://tiles.openfreemap.org'),
  '/proxy/nominatim': toUpstream('NOMINATIM', 'https://nominatim.openstreetmap.org'),
  '/proxy/valhalla1': toUpstream('VALHALLA1', 'https://valhalla1.openstreetmap.de'),
  '/proxy/valhalla2': toUpstream('VALHALLA2', 'https://valhalla2.openstreetmap.de'),
  '/proxy/osrm': toUpstream('OSRM', 'https://router.project-osrm.org'),
  '/proxy/osm': toUpstream('OSM', 'https://tile.openstreetmap.org'),
};

export default defineConfig({
  base: './',
  // the Arena live-preview proxies via a dynamic host (*.e2b.app) — allow it
  server: { allowedHosts: true, proxy: serviceProxy },
  preview: { allowedHosts: true, proxy: serviceProxy },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // we ship our own public/manifest.webmanifest — don't let the plugin overwrite it
      manifest: false,
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      workbox: {
        // maplibre-gl is ~900 kB uncompressed; keep headroom
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            // OpenFreeMap vector tiles + glyphs: immutable-ish, safe to cache hard
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lostless-map-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              // never cache an error/opaque tile response for 30 days
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // OSM raster tiles (only used by the no-WebGL2 Leaflet fallback)
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lostless-osm-raster',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 },
              // never cache an error/opaque tile response for 14 days
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Nominatim geocoding: always try network first (results change)
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'lostless-geocode', networkTimeoutSeconds: 8 },
          },
          {
            // Public Valhalla instance
            urlPattern: /^https:\/\/(valhalla1\.openstreetmap\.de|valhalla2\.openstreetmap\.de)\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'lostless-route', networkTimeoutSeconds: 10 },
          },
          {
            // Public OSRM demo server
            urlPattern: /^https:\/\/router\.project-osrm\.org\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'lostless-route', networkTimeoutSeconds: 10 },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
