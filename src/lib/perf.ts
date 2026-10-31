/**
 * Lite-mode detection for older / weaker phones.
 * Used to default the "LITE MODE" setting (raster map + no animations).
 */
export function weakHardware(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number; saveData?: boolean };
    const cores = navigator.hardwareConcurrency ?? 8;
    if (cores <= 4) return true;
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return true;
    if (nav.saveData) return true;
    return false;
  } catch {
    return false;
  }
}
