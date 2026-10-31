// Copies the MapLibre worker into public/ so it is served same-origin.
// MapView sets maplibregl.config.WORKER_URL to this file (instead of the
// default inline blob worker) so the map also works under a strict CSP,
// e.g. inside the Arena live preview.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js');
const destDir = join(root, 'public');
const dest = join(destDir, 'maplibre-gl-csp-worker.js');

if (!existsSync(src)) {
  console.error(`[copy-maplibre-worker] ${src} not found — run "npm install" first`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-maplibre-worker] ${src} -> ${dest}`);
