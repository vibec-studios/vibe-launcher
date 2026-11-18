// Fensterhintergrund: Verlauf, eigenes Bild, eigenes Video/GIF/WebP oder eine eingebaute, dezente Animation
// (Aurora per CSS; Partikel, Wellen, Blöcke per Canvas mit max. 30 fps). Darüber liegt die Abdunklung.
// Pausiert, wenn das Fenster unsichtbar/minimiert ist oder ein Spiel läuft; „Animationen reduzieren“ und
// prefers-reduced-motion zeigen ein Standbild.
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { isRunning, useGameStore, useSettings } from "@/lib/queries";
import { GRADIENTS, hasBackground, isVideoFile } from "@/lib/appearance";
import { imageSrc } from "@/lib/format";
import type { Appearance } from "@/lib/types";
import { cn } from "@/components/ui";

// ------------------------------------------------------------------ Pausieren

function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

function useSystemReducedMotion() {
  const [reduce, setReduce] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** still = nie animieren (Standbild), paused = gerade anhalten (unsichtbar / Spiel läuft). */
function useMotion() {
  const visible = usePageVisible();
  const gameRunning = useGameStore((s) => Object.values(s.states).some((g) => isRunning(g)));
  const settingReduce = useSettings().data?.reduce_motion ?? false;
  const sysReduce = useSystemReducedMotion();
  const still = settingReduce || sysReduce;
  return { still, paused: still || !visible || gameRunning };
}

// ------------------------------------------------------------------ Canvas-Animationen

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, accent: string) => void;

function rand(seed: number) {
  // Deterministisch, damit das Standbild stabil bleibt
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function makeParticles(): Painter {
  const r = rand(7);
  const ps = Array.from({ length: 90 }, () => ({ x: r(), y: r(), s: 1.5 + r() * 2.5, v: 0.006 + r() * 0.018, ph: r() * Math.PI * 2, a: 0.25 + r() * 0.55 }));
  return (ctx, w, h, t, accent) => {
    ctx.clearRect(0, 0, w, h);
    const n = Math.min(ps.length, Math.round((w * h) / 14000));
    ctx.fillStyle = accent;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const y = (((p.y - t * p.v) % 1) + 1) % 1;
      const x = p.x + Math.sin(t * 0.25 + p.ph) * 0.012;
      ctx.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(t * 0.9 + p.ph)) * (0.35 + 0.65 * (1 - y));
      const s = Math.round(p.s);
      ctx.fillRect(Math.round(x * w), Math.round(y * h), s, s);
    }
    ctx.globalAlpha = 1;
  };
}

function makeWaves(): Painter {
  const lines = [
    { y: 0.62, a: 0.06, f: 1.3, s: 0.12, o: 0.32, wdt: 1.5 },
    { y: 0.68, a: 0.05, f: 1.8, s: -0.09, o: 0.22, wdt: 1.2 },
    { y: 0.74, a: 0.07, f: 1.1, s: 0.07, o: 0.16, wdt: 1 },
    { y: 0.8, a: 0.045, f: 2.2, s: -0.13, o: 0.12, wdt: 1 },
    { y: 0.86, a: 0.05, f: 1.5, s: 0.1, o: 0.08, wdt: 1 },
  ];
  return (ctx, w, h, t, accent) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
    g.addColorStop(0, "transparent");
    g.addColorStop(1, accent);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    ctx.strokeStyle = accent;
    for (const l of lines) {
      ctx.globalAlpha = l.o;
      ctx.lineWidth = l.wdt;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const u = x / w;
        const y = h * (l.y + l.a * Math.sin(u * Math.PI * 2 * l.f + t * l.s * 2) + 0.02 * Math.sin(u * 9 + t * 0.4));
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
}

function makeBlocks(): Painter {
  const r = rand(42);
  const bs = Array.from({ length: 16 }, () => ({ x: r(), y: r(), s: 36 + r() * 110, v: 0.004 + r() * 0.01, rot: r() * Math.PI, vr: (r() - 0.5) * 0.06, a: 0.04 + r() * 0.06 }));
  return (ctx, w, h, t, accent) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    for (const b of bs) {
      const y = ((((b.y - t * b.v) % 1.2) + 1.2) % 1.2) - 0.1;
      ctx.save();
      ctx.translate(b.x * w, y * h);
      ctx.rotate(b.rot + t * b.vr);
      ctx.globalAlpha = b.a;
      ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s);
      ctx.globalAlpha = b.a * 2.2;
      ctx.lineWidth = 1;
      ctx.strokeRect(-b.s / 2, -b.s / 2, b.s, b.s);
      // Pixel-Muster wie beim Logo-Block
      ctx.globalAlpha = b.a * 2.6;
      const q = b.s / 8;
      ctx.fillRect(-b.s / 2 + q, -b.s / 2 + q, q, q);
      ctx.fillRect(b.s / 2 - 2 * q, b.s / 2 - 3 * q, q, q);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };
}

const PAINTERS = { particles: makeParticles, waves: makeWaves, blocks: makeBlocks };

const CanvasAnim = memo(function CanvasAnim({ kind, accent, paused }: { kind: keyof typeof PAINTERS; accent: string; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ accent, paused, t: 0 });
  state.current.accent = accent;
  state.current.paused = paused;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const paint = PAINTERS[kind]();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0,
      h = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, w, h, state.current.t, state.current.accent);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (state.current.paused) return;
      acc += dt;
      if (acc < 1 / 30) return; // höchstens 30 fps
      state.current.t += acc;
      acc = 0;
      paint(ctx, w, h, state.current.t, state.current.accent);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [kind]);

  // Farbwechsel auch im Standbild sofort zeigen
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !paused) return;
    const rect = canvas.getBoundingClientRect();
    PAINTERS[kind]()(ctx, rect.width, rect.height, state.current.t, accent);
  }, [accent, paused, kind]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
});

function Aurora({ accent, paused }: { accent: string; paused: boolean }) {
  const blob = (style: CSSProperties) => (
    <div className="absolute rounded-full" style={{ animationPlayState: paused ? "paused" : "running", willChange: "transform", ...style }} />
  );
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#07070b" }}>
      <style>{`
        @keyframes vl-aurora-a { 0% { transform: translate(-10%, -8%) scale(1) rotate(0deg); } 100% { transform: translate(18%, 12%) scale(1.25) rotate(25deg); } }
        @keyframes vl-aurora-b { 0% { transform: translate(12%, 10%) scale(1.15); } 100% { transform: translate(-16%, -6%) scale(.9); } }
        @keyframes vl-aurora-c { 0% { transform: translate(0, 14%) scale(.95); } 100% { transform: translate(-8%, -14%) scale(1.2); } }
      `}</style>
      {blob({
        left: "-15%",
        top: "-30%",
        width: "75%",
        height: "90%",
        background: `radial-gradient(closest-side, color-mix(in srgb, ${accent} 65%, transparent), transparent)`,
        animation: "vl-aurora-a 38s ease-in-out infinite alternate",
      })}
      {blob({
        right: "-20%",
        top: "10%",
        width: "70%",
        height: "85%",
        background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 45%, #3fe0c5 55%), transparent)`,
        opacity: 0.55,
        animation: "vl-aurora-b 46s ease-in-out infinite alternate",
      })}
      {blob({
        left: "15%",
        bottom: "-45%",
        width: "80%",
        height: "80%",
        background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 50%, #ff6b9a 50%), transparent)`,
        opacity: 0.45,
        animation: "vl-aurora-c 54s ease-in-out infinite alternate",
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Eigene Dateien

/** Animiertes Bild (GIF/WebP): beim Pausieren wird das aktuelle Bild auf ein Canvas gemalt und das <img> versteckt. */
function AnimatedImage({ src, paused }: { src: string; paused: boolean }) {
  const img = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const i = img.current,
      c = canvas.current;
    if (!paused || !i || !c || !i.complete || !i.naturalWidth) return;
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext("2d")?.drawImage(i, 0, 0);
  }, [paused]);
  return (
    <>
      <img ref={img} src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ display: paused ? "none" : undefined }} />
      <canvas ref={canvas} className="absolute inset-0 h-full w-full object-cover" style={{ display: paused ? undefined : "none" }} />
    </>
  );
}

function Video({ src, paused }: { src: string; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) v.pause();
    else v.play().catch(() => {});
  }, [paused, src]);
  return <video ref={ref} src={src} muted loop playsInline autoPlay={!paused} preload="auto" className="absolute inset-0 h-full w-full object-cover" />;
}

// ------------------------------------------------------------------ Hintergrund

function Media({ a, paused }: { a: Appearance; paused: boolean }) {
  const b = a.background;
  if (b.kind === "gradient") return <div className="absolute inset-0" style={{ background: GRADIENTS[b.gradient]?.(a.accent) ?? GRADIENTS.accent(a.accent) }} />;
  if (b.kind === "image" && b.image) {
    const src = imageSrc(b.image);
    if (!src) return null;
    return /\.(gif|webp)$/i.test(b.image) ? <AnimatedImage src={src} paused={paused} /> : <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />;
  }
  if (b.kind === "animated") {
    if (b.animated === "custom") {
      const src = imageSrc(b.video);
      if (!src) return null;
      return isVideoFile(b.video) ? <Video src={src} paused={paused} /> : <AnimatedImage src={src} paused={paused} />;
    }
    if (b.animated === "aurora") return <Aurora accent={a.accent} paused={paused} />;
    return (
      <div className="absolute inset-0" style={{ background: GRADIENTS.accent(a.accent) }}>
        <CanvasAnim kind={b.animated} accent={a.accent} paused={paused} />
      </div>
    );
  }
  return null;
}

/**
 * Hintergrund-Ebene. Standard: fest hinter dem ganzen Fenster (z-index -1).
 * `contained`: füllt den Eltern-Container (Vorschau im Einstellungs-Tab).
 */
export function Backdrop({ appearance: a, contained, className }: { appearance: Appearance; contained?: boolean; className?: string }) {
  const { paused } = useMotion();
  if (!hasBackground(a)) return null;
  const blur = a.background.blur;
  return (
    <div aria-hidden className={cn(contained ? "absolute inset-0" : "fixed inset-0 -z-10", "pointer-events-none overflow-hidden", className)}>
      <div
        className="absolute inset-0"
        style={blur > 0 ? { filter: `blur(${contained ? blur / 3 : blur}px)`, transform: "scale(1.08)" } : undefined}
      >
        <Media a={a} paused={paused} />
      </div>
      <div className="absolute inset-0" style={{ background: `rgb(0 0 0 / ${a.background.dim / 100})` }} />
    </div>
  );
}
