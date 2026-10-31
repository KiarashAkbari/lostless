import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' so the same build works on GitHub Pages (project site under /<repo>/)
// and on Vercel (served at the domain root).
export default defineConfig({
  base: './',
  // the Arena live-preview proxies via a dynamic host (*.e2b.app) — allow it
  server: { allowedHosts: true },
  preview: { allowedHosts: true },
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
            },
          },
          {
            // OSM raster tiles (only used by the no-WebGL2 Leaflet fallback)
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lostless-osm-raster',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 },
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
