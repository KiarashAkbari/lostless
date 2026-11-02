import { useCallback, useRef, useState } from 'react';
import type { Banner } from '../types';

export interface PushBannerOpts {
  tag?: string;
  sticky?: boolean;
  action?: Banner['action'];
  action2?: Banner['action2'];
}

export interface BannersApi {
  banners: Banner[];
  pushBanner: (kind: Banner['kind'], msg: string, opts?: PushBannerOpts) => void;
  dismissBanner: (id: number) => void;
  /** remove all banners with any of the given tags */
  clearTags: (...tags: string[]) => void;
}

/**
 * Toast/banner state for the whole app. Banners with a `tag` replace the
 * previous banner of the same tag (status lines like gps/net/map); untagged
 * banners stack. Non-sticky banners auto-dismiss after 6.5 s.
 */
export function useBanners(): BannersApi {
  const [banners, setBanners] = useState<Banner[]>([]);
  const seq = useRef(0);

  const dismissBanner = useCallback((id: number) => {
    setBanners((b) => b.filter((x) => x.id !== id));
  }, []);

  const pushBanner = useCallback(
    (kind: Banner['kind'], msg: string, opts?: PushBannerOpts) => {
      const id = ++seq.current;
      const banner: Banner = { id, kind, msg, tag: opts?.tag, action: opts?.action, action2: opts?.action2 };
      if (opts?.tag) setBanners((b) => [...b.filter((x) => x.tag !== opts.tag), banner]);
      else setBanners((b) => [...b, banner]);
      if (!opts?.sticky) setTimeout(() => dismissBanner(id), 6500);
    },
    [dismissBanner],
  );

  const clearTags = useCallback((...tags: string[]) => {
    setBanners((b) => b.filter((x) => !x.tag || !tags.includes(x.tag)));
  }, []);

  return { banners, pushBanner, dismissBanner, clearTags };
}
