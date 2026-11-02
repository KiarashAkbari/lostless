import React from 'react';
import { createRoot } from 'react-dom/client';
// system font stacks only (see --sans/--mono in styles.css) — no webfont
// downloads, so first paint and the map appear as early as possible
import './styles.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerSW } from 'virtual:pwa-register';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// PWA service worker (built by vite-plugin-pwa; only active in production builds)
registerSW({ immediate: true });

// warm the heavy map chunk while the browser is idle, so the map pops in faster
try {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(() => void import('./components/MapView'), { timeout: 2500 });
  else setTimeout(() => void import('./components/MapView'), 800);
} catch {
  // prefetch is best-effort
}
