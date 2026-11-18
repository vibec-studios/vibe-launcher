// Kleine Bewegungs-Bausteine für „Mehr Animationen“. Die Dauer kommt aus der CSS-Variable --motion-num
// (globals.css): 0 ms im normalen/reduzierten Modus -> Zahl springt sofort, sonst zählt sie weich hoch/runter.
import { useEffect, useRef, useState } from "react";

function motionMs(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--motion-num").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : 0;
}

/** Zahl, die im Modus „Mehr Animationen“ zum neuen Wert zählt (ease-out). Formatierung über `format`. */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const ms = motionMs();
    cancelAnimationFrame(raf.current);
    if (ms <= 0 || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span className={className}>{format(shown)}</span>;
}
