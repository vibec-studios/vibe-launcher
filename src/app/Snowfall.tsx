// Winter-Theme: dezenter Schneefall auf einem Canvas über dem Fenster (unter Dialogen, klickdurchlässig).
// - drei Tiefenebenen: hinten winzig/langsam/blass, vorn größer/schneller – vorn nur wenige Flocken
// - leichter, sich langsam ändernder Wind (zwei überlagerte Sinus + seltene Böen), Flocken pendeln
// - Parallaxe: die Ebenen verschieben sich je nach Tiefe leicht mit der Mausposition
// - optional: ganz wenig Schnee sammelt sich auf der Oberkante der Inhaltsfläche (2-px-Pixelsäulen, taut langsam)
// Performance: höchstens 30 fps, eine Füllung pro Ebene (ein Pfad), Anzahl nach Fensterfläche begrenzt,
// rAF stoppt komplett bei minimiertem/verstecktem Fenster, laufendem Spiel oder reduzierter Bewegung (dann bleibt
// ein Standbild stehen).
import { memo, useEffect, useRef } from "react";
import { cn } from "@/components/ui";
import { useMotion } from "./motion";

interface Flake {
  x: number;
  y: number;
  r: number;
  vy: number;
  layer: number;
  ph: number;
  sway: number;
  freq: number;
}

/** Tiefenebenen: Parallaxe-Faktor, Größe, Fallgeschwindigkeit (px/s), Deckkraft, Anteil */
const LAYERS = [
  { depth: 0.3, r: [0.55, 0.95], vy: [11, 17], alpha: 0.3, share: 0.56 },
  { depth: 0.62, r: [0.95, 1.55], vy: [20, 30], alpha: 0.6, share: 0.32 },
  { depth: 1, r: [1.6, 2.4], vy: [34, 48], alpha: 0.78, share: 0.12 },
] as const;

const COLOR = "#eaf4ff";
const COL_W = 2; // Breite einer Schneesäule auf Kanten (px)
const MAX_PILE = 3; // höchstens 3 px Schnee

function lerp(a: readonly [number, number], t: number) {
  return a[0] + (a[1] - a[0]) * t;
}

export const Snowfall = memo(function Snowfall({
  amount = 50,
  settle = true,
  contained,
  className,
}: {
  /** 10–100 % */
  amount?: number;
  settle?: boolean;
  /** Füllt den Eltern-Container (Vorschau) statt des Fensters */
  contained?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { paused } = useMotion();
  const live = useRef({ paused, amount, settle });
  live.current = { paused, amount, settle };
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 1,
      h = 1;
    let flakes: Flake[] = [];
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    const spawn = (f: Flake | null, top: boolean): Flake => {
      const u = rnd();
      const layer = u < LAYERS[0].share ? 0 : u < LAYERS[0].share + LAYERS[1].share ? 1 : 2;
      const L = LAYERS[layer];
      const n = f ?? ({} as Flake);
      n.layer = layer;
      n.r = lerp(L.r, rnd());
      n.vy = lerp(L.vy, rnd());
      n.x = rnd() * (w + 80) - 40;
      n.y = top ? -10 - rnd() * 40 : rnd() * h;
      n.ph = rnd() * Math.PI * 2;
      n.sway = 4 + rnd() * 10 * L.depth;
      n.freq = 0.4 + rnd() * 0.6;
      return n;
    };

    const target = () => {
      // ~110 Flocken bei 1600×900 und 50 %; Vorschau mindestens ein paar
      const k = (w * h) / (1600 * 900);
      return Math.max(contained ? 28 : 12, Math.round(110 * k * (live.current.amount / 50)));
    };
    const fill = () => {
      const n = target();
      if (flakes.length > n) flakes.length = n;
      while (flakes.length < n) flakes.push(spawn(null, false));
    };

    // ---------------------------------------------------------------- Kante (Oberkante der Inhaltsfläche)
    let ledge: { x0: number; y: number; cols: Float32Array } | null = null;
    const measureLedge = () => {
      if (contained || !live.current.settle) {
        ledge = null;
        return;
      }
      const main = document.querySelector("main");
      if (!main) return;
      const r = main.getBoundingClientRect();
      const n = Math.max(1, Math.floor(r.width / COL_W));
      if (ledge && ledge.x0 === Math.round(r.left) && ledge.y === Math.round(r.top) && ledge.cols.length === n) return;
      ledge = { x0: Math.round(r.left), y: Math.round(r.top), cols: new Float32Array(n) };
      // Es liegt schon ein wenig Schnee: ein paar kleine, verstreute Häufchen
      for (let i = 0; i < Math.round(n / 40); i++) {
        const c = Math.floor(rnd() * n);
        const hgt = 1 + rnd() * 1.6;
        for (let j = -2; j <= 2; j++) if (c + j >= 0 && c + j < n) ledge.cols[c + j] = Math.max(ledge.cols[c + j], hgt - Math.abs(j) * 0.6);
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fill();
      measureLedge();
      draw();
    };

    // ---------------------------------------------------------------- Maus-Parallaxe (geglättet)
    const mouse = { tx: 0, ty: 0, x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (!contained) window.addEventListener("pointermove", onMove, { passive: true });

    let t = 0;
    const wind = (time: number) => 9 * Math.sin(time * 0.07) + 5 * Math.sin(time * 0.23 + 1.3) + 6 * Math.max(0, Math.sin(time * 0.031 + 4)) ** 6;

    const step = (dt: number) => {
      t += dt;
      const wv = wind(t);
      mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 2.5);
      mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 2.5);
      const lg = ledge;
      for (const f of flakes) {
        const L = LAYERS[f.layer];
        const prevY = f.y;
        f.y += f.vy * dt;
        f.x += (wv * L.depth + Math.cos(t * f.freq + f.ph) * f.sway * 0.35) * dt;
        // Liegenbleiben: nur mittlere/vordere Flocken, nur ein Teil davon
        if (lg && f.layer > 0 && prevY < lg.y && f.y >= lg.y) {
          const ci = Math.floor((f.x - lg.x0) / COL_W);
          if (ci >= 0 && ci < lg.cols.length && rnd() < 0.3) {
            const add = f.layer === 2 ? 0.9 : 0.5;
            lg.cols[ci] = Math.min(MAX_PILE, lg.cols[ci] + add);
            if (ci > 0) lg.cols[ci - 1] = Math.min(MAX_PILE, lg.cols[ci - 1] + add * 0.4);
            if (ci + 1 < lg.cols.length) lg.cols[ci + 1] = Math.min(MAX_PILE, lg.cols[ci + 1] + add * 0.4);
            spawn(f, true);
            continue;
          }
        }
        if (f.y > h + 10 || f.x < -60 || f.x > w + 60) spawn(f, true);
      }
      // Tauen: hält die Schneekante dauerhaft hauchdünn
      if (lg) for (let i = 0; i < lg.cols.length; i++) if (lg.cols[i] > 0) lg.cols[i] = Math.max(0, lg.cols[i] - dt * 0.025);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR;
      for (let li = 0; li < LAYERS.length; li++) {
        const L = LAYERS[li];
        const ox = -mouse.x * 14 * L.depth;
        const oy = -mouse.y * 6 * L.depth;
        ctx.globalAlpha = L.alpha;
        ctx.beginPath();
        for (const f of flakes) {
          if (f.layer !== li) continue;
          const x = f.x + ox,
            y = f.y + oy;
          if (f.r < 1.1) {
            ctx.rect(x, y, f.r * 1.6, f.r * 1.6);
          } else {
            ctx.moveTo(x + f.r, y);
            ctx.arc(x, y, f.r, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }
      const lg = ledge;
      if (lg) {
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        for (let i = 0; i < lg.cols.length; i++) {
          const hh = Math.round(lg.cols[i]);
          if (hh > 0) ctx.rect(lg.x0 + i * COL_W, lg.y - hh, COL_W, hh);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    // ---------------------------------------------------------------- Schleife
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const stats = import.meta.env.DEV || import.meta.env.VITE_MOCK === "1" ? ((window as unknown as { __vlSnow?: { frames: number; cost: number; flakes: number } }).__vlSnow = { frames: 0, cost: 0, flakes: 0 }) : null;
    const frame = (now: number) => {
      if (live.current.paused) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (acc < 1 / 30) return; // höchstens 30 fps
      const t0 = performance.now();
      step(acc);
      acc = 0;
      draw();
      if (stats) {
        stats.frames++;
        stats.cost += performance.now() - t0;
        stats.flakes = flakes.length;
      }
    };
    wake.current = () => {
      if (raf || live.current.paused) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    // Kante und Menge gelegentlich nachführen (Seitenleiste breiter, Menge geändert …)
    const timer = setInterval(() => {
      if (live.current.paused) return;
      fill();
      measureLedge();
    }, 1000);
    wake.current();
    return () => {
      cancelAnimationFrame(raf);
      wake.current = () => {};
      clearInterval(timer);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [contained]);

  useEffect(() => {
    if (!paused) wake.current();
  }, [paused]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none", contained ? "absolute inset-0 h-full w-full" : "fixed inset-0 z-[45] h-full w-full", className)}
    />
  );
});
