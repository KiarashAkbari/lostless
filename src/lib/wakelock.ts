/**
 * Screen Wake Lock API — keeps the screen awake while navigating.
 * Supported in Chrome/Edge/Samsung Internet on Android, recent Safari 16.4+.
 * Where unsupported we just report `false` and the UI says so.
 */

interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

let sentinel: WakeLockSentinelLike | null = null;

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export async function acquireWakeLock(): Promise<boolean> {
  if (!wakeLockSupported()) return false;
  try {
    const nav = navigator as unknown as { wakeLock: WakeLockLike };
    sentinel = await nav.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    return true;
  } catch {
    sentinel = null;
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    // already released
  }
  sentinel = null;
}

/** re-acquire when the tab becomes visible again (the OS may release the lock) */
export function reacquireOnVisible(): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible' && sentinel === null) {
      void acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
