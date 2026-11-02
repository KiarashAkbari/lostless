/**
 * Shared client-side rate limiter.
 *
 * Nominatim's usage policy and the public FOSSGIS Valhalla instances both ask
 * for max 1 request/second — so every outbound call to them goes through a
 * throttler created here. The interval is read lazily through a getter, so
 * tests (and CONFIG changes) take effect without recreating the throttler.
 */
export function createThrottler(getMinIntervalMs: () => number) {
  let lastAt = 0;
  return async function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const wait = Math.max(0, getMinIntervalMs() - (Date.now() - lastAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  };
}
