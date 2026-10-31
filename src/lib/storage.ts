import { CONFIG } from '../config';
import type { Place } from '../types';

/** Favorites live in localStorage — on-device only, nothing leaves the phone. */

function read(): Place[] {
  try {
    const raw = localStorage.getItem(CONFIG.storageKeys.favorites);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Place[];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number') : [];
  } catch {
    return [];
  }
}

function write(list: Place[]): void {
  try {
    localStorage.setItem(CONFIG.storageKeys.favorites, JSON.stringify(list));
  } catch {
    // storage full / private mode — favorites just won't persist
  }
}

export function getFavorites(): Place[] {
  return read();
}

export function isFavorite(id: string): boolean {
  return read().some((p) => p.id === id);
}

export function addFavorite(p: Place): Place[] {
  const list = read().filter((x) => x.id !== p.id);
  list.unshift(p);
  write(list);
  return list;
}

export function removeFavorite(id: string): Place[] {
  const list = read().filter((x) => x.id !== id);
  write(list);
  return list;
}

export function getTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem(CONFIG.storageKeys.theme);
    return t === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(t: 'dark' | 'light'): void {
  try {
    localStorage.setItem(CONFIG.storageKeys.theme, t);
  } catch {
    // ignore
  }
}
