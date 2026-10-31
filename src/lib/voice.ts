/**
 * Spoken turn-by-turn guidance while navigating.
 * Uses the browser's built-in speech engine (Web Speech API) — free, no keys,
 * no network. Guarded so it silently no-ops where unsupported (jsdom, old WebViews).
 */

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function speak(text: string, lang = 'en-US'): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.05;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch {
    // ignore — voice is best-effort
  }
}

export function cancelSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
