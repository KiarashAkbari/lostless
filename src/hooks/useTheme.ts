import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme } from '../lib/storage';

export type Theme = 'dark' | 'light';

/** Dark by default; the toggle is persisted on-device. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.getElementById('meta-theme-color') as HTMLMetaElement | null;
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b0e12' : '#f4f6f8');
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      setTheme(next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
