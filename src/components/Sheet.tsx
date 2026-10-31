import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import type { SheetSnap } from '../types';

interface SheetProps {
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  /** always-visible top section (search + summary) */
  peek: ReactNode;
  /** scrollable body (results / steps / favorites) */
  body: ReactNode;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Bottom sheet with three snap points: hidden / peek / full.
 * Drag the grabber; a tap on the grabber toggles peek ↔ full.
 */
export function Sheet({ snap, onSnap, peek, body }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const metrics = useRef({ height: 420, peek: 170 });
  const drag = useRef<{ startY: number; startOffset: number; moved: number } | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const offsetFor = (s: SheetSnap, m = metrics.current) =>
    s === 'hidden' ? m.height + 16 : s === 'peek' ? m.height - m.peek : 0;

  useLayoutEffect(() => {
    const el = sheetRef.current;
    const pk = peekRef.current;
    if (!el || !pk) return;
    const measure = () => {
      metrics.current = {
        height: el.offsetHeight,
        peek: Math.min(pk.offsetHeight, el.offsetHeight),
      };
      if (!drag.current) setOffset(offsetFor(snapRef.current));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(pk);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dragging) setOffset(offsetFor(snap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, dragging]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startOffset: offset ?? offsetFor(snapRef.current), moved: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.abs(dy));
    setOffset(clamp(d.startOffset + dy, 0, metrics.current.height + 16));
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (d.moved < 6) {
      // treat as a tap: toggle peek <-> full (hidden -> peek)
      onSnap(snapRef.current === 'full' ? 'peek' : snapRef.current === 'peek' ? 'full' : 'peek');
      return;
    }
    const cur = offset ?? 0;
    const m = metrics.current;
    const candidates: Array<[SheetSnap, number]> = [
      ['hidden', m.height + 16],
      ['peek', m.height - m.peek],
      ['full', 0],
    ];
    let best = candidates[0];
    for (const c of candidates) if (Math.abs(c[1] - cur) < Math.abs(best[1] - cur)) best = c;
    onSnap(best[0]);
  };

  return (
    <div
      ref={sheetRef}
      className={`sheet${dragging ? ' dragging' : ''}`}
      style={{ transform: offset === null ? 'translate(-50%, 110%)' : `translate(-50%, ${offset}px)` }}
    >
      <div
        className="grabber"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="button"
        aria-label="drag to resize panel"
      >
        <span className="grabber-bar" />
      </div>
      <div ref={peekRef} className="sheet-peek">
        {peek}
      </div>
      <div className="sheet-body">{body}</div>
    </div>
  );
}
