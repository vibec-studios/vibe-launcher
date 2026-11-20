import { useEffect, useRef, useState } from "react";

export type Tier = "s" | "m" | "l";

const tierOf = (w: number): Tier => (w >= 1560 ? "l" : w >= 1180 ? "m" : "s");

export function useTier<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [tier, setTier] = useState<Tier>("s");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTier(tierOf(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, tier] as const;
}

export const sideWidth: Record<Tier, string> = { s: "w-[300px]", m: "w-[340px]", l: "w-[320px]" };

const updatesLimit: Record<Tier, number> = { s: 5, m: 5, l: 8 };

export function useHeight<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, h] as const;
}

const ROW = 49;
const CHROME = 34 + 8 + 40;

export function fitRows(left: number, above: number, tier: Tier) {
  if (!left) return updatesLimit[tier];
  const room = left - (above ? above + 24 : 0) - CHROME;
  return Math.min(8, Math.max(3, Math.floor(room / ROW)));
}
