import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import type { SheetSnap } from '../types';

interface SheetProps {
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  /** always-visible top section (grabber + search + summary) */
  peek: ReactNode;
  /** scrollable body (results / steps / favorites) */
  body: ReactNode;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Bottom sheet living in the normal layout flow (the map resizes with it —
 * nothing ever overlaps the map buttons or attribution).
 * Three snap heights: hidden (0) / peek (grabber + search + summary) / full.
 * Drag the grabber; a tap on the grabber toggles peek ↔ full.
 */
export function Sheet({ snap, onSnap, peek, body }: SheetProps) {
  const peekRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const fullH = () => Math.min(440, Math.round(window.innerHeight * 0.62));
  const peekHRef = useRef(170);
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startH: number; moved: number } | null>(null);

  const snapHeight = (s: SheetSnap, peekH: number) => {
    const H = fullH();
    if (s === 'hidden') return 0;
    if (s === 'full') return H;
    return Math.min(peekH, H);
  };

  useLayoutEffect(() => {
    const pk = peekRef.current;
    if (!pk) return;
    const measure = () => {
      peekHRef.current = Math.min(pk.offsetHeight, fullH());
      if (!drag.current) setHeight(snapHeight(snapRef.current, peekHRef.current));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pk);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dragging) setHeight(snapHeight(snap, peekHRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, dragging]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startH: height ?? snapHeight(snapRef.current, peekHRef.current), moved: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY; // dragging down shrinks the sheet
    d.moved = Math.max(d.moved, Math.abs(dy));
    setHeight(clamp(d.startH - dy, 0, fullH()));
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (d.moved < 6) {
      // tap on grabber: toggle peek <-> full (hidden -> peek)
      onSnap(snapRef.current === 'full' ? 'peek' : snapRef.current === 'peek' ? 'full' : 'peek');
      return;
    }
    const cur = height ?? 0;
    const H = fullH();
    const candidates: Array<[SheetSnap, number]> = [
      ['hidden', 0],
      ['peek', Math.min(peekHRef.current, H)],
      ['full', H],
    ];
    let best = candidates[0];
    for (const c of candidates) if (Math.abs(c[1] - cur) < Math.abs(best[1] - cur)) best = c;
    onSnap(best[0]);
  };

  const h = height ?? 0;
  return (
    <div
      className={`sheet${dragging ? ' dragging' : ''}${h === 0 ? ' collapsed' : ''}`}
      style={{ height: h }}
      data-snap={snap}
    >
      <div className="sheet-peek" ref={peekRef}>
        <div
          className="grabber"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="button"
          aria-label="drag to resize panel, tap to expand"
        >
          <span className="grabber-bar" />
        </div>
        {peek}
      </div>
      <div className="sheet-body">{body}</div>
    </div>
  );
}
