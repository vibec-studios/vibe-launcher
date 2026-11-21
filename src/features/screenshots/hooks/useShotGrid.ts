import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Screenshot } from "@/lib/types";
import { useLang, useT } from "@/i18n";
import { bucket } from "../shots";
import { GAP, HEAD_H, MIN_TILE, PAD, type Row } from "../layout";

export function useShotGrid(shots: Screenshot[]) {
  const t = useT();
  const lang = useLang((s) => s.lang);

  // Spaltenzahl aus der Breite des Scrollbereichs
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - PAD * 2));
    ro.observe(el);
    setWidth(el.clientWidth - PAD * 2);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP)));
  const tileW = width > 0 ? (width - (cols - 1) * GAP) / cols : MIN_TILE;
  const tileH = Math.round((tileW * 9) / 16);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const now = new Date();
    let i = 0;
    while (i < shots.length) {
      const b = bucket(shots[i].taken_at, now);
      let j = i;
      while (j < shots.length && bucket(shots[j].taken_at, now).key === b.key) j++;
      out.push({ kind: "head", label: b.label(t, lang), count: j - i });
      for (let k = i; k < j; k += cols) out.push({ kind: "tiles", items: shots.slice(k, Math.min(k + cols, j)), start: k });
      i = j;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, cols, lang]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (n) => (rows[n].kind === "head" ? HEAD_H : tileH + GAP),
    overscan: 4,
  });
  useEffect(() => v.measure(), [tileH, rows, v]);

  return { scrollRef, cols, tileH, rows, v };
}
