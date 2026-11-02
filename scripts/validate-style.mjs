// dev helper: validate the hand-written basemap against the official spec
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildBaseStyle } from '../src/lib/mapStyle.ts';

let bad = 0;
for (const theme of ['light', 'dark']) {
  const errors = validateStyleMin(buildBaseStyle(theme));
  console.log(`${theme}: ${errors.length} error(s)`);
  for (const e of errors) {
    bad += 1;
    console.log('  -', e.message);
  }
}
process.exit(bad ? 1 : 0);
