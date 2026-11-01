import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wrapper config — packages the PWA build (dist/) as an Android APK.
 * The web app loads from https://localhost inside the WebView, which is a
 * secure context, so navigator.geolocation works once the app holds the
 * location permissions (see android/app/src/main/AndroidManifest.xml).
 * The host is not *.e2b.app here, so all map/routing calls use the direct
 * free https service URLs from src/config.ts (no preview proxy needed).
 */
const config: CapacitorConfig = {
  appId: 'app.lostless.nav',
  appName: 'lostless_',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
