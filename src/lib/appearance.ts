// Darstellung anwenden: setzt Attribute/Variablen an <html> (siehe src/styles/globals.css) und merkt sich die
// letzten Werte in localStorage, damit schon der erste Frame richtig aussieht (applyCachedAppearance in main.tsx).
// Während das Einstellungs-Popup offen ist, zeigt `useAppearanceDraft` die ungespeicherte Vorschau.
import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Appearance, BackgroundGradient } from "./types";
import { onAccent } from "./format";

export const DEFAULT_APPEARANCE: Appearance = {
  accent: "#8b6cff",
  tone: "dark",
  radius: "slight",
  density: "normal",
  ui_scale: 100,
  background: { kind: "none", gradient: "accent", animated: "aurora", image: null, video: null, dim: 45, blur: 0 },
};

export const ACCENT_PRESETS = ["#8b6cff", "#5aa9ff", "#3fe0c5", "#7ee07a", "#ffb547", "#ff7a45", "#ff6b9a", "#e05cff"];

/** Statische Verläufe. `a` = Akzentfarbe. */
export const GRADIENTS: Record<BackgroundGradient, (a: string) => string> = {
  accent: (a) =>
    `radial-gradient(90% 70% at 12% 0%, color-mix(in srgb, ${a} 42%, transparent), transparent 70%), radial-gradient(70% 60% at 100% 100%, color-mix(in srgb, ${a} 22%, transparent), transparent 70%), #0b0b10`,
  dusk: () => "radial-gradient(80% 70% at 10% 0%, #5b2fd0aa, transparent 70%), radial-gradient(80% 70% at 100% 100%, #d0367a88, transparent 70%), linear-gradient(160deg, #120c24, #1a0b18)",
  ocean: () => "radial-gradient(80% 70% at 0% 100%, #0f6f8a99, transparent 70%), radial-gradient(70% 60% at 100% 0%, #2a4fd088, transparent 70%), linear-gradient(160deg, #06121c, #070b1a)",
  ember: () => "radial-gradient(80% 70% at 100% 0%, #d0582a99, transparent 70%), radial-gradient(70% 60% at 0% 100%, #8a1f3a88, transparent 70%), linear-gradient(160deg, #1a0d08, #140609)",
  forest: () => "radial-gradient(80% 70% at 0% 0%, #2f8a4a99, transparent 70%), radial-gradient(70% 60% at 100% 100%, #1f6a6a88, transparent 70%), linear-gradient(160deg, #07130b, #06110f)",
};

const CACHE_KEY = "vl.appearance";

/** Ungespeicherte Vorschau aus dem Einstellungs-Tab (null = gespeicherte Werte). */
export const useAppearanceDraft = create<{ draft: Appearance | null }>(() => ({ draft: null }));

function merge(a: Partial<Appearance> | null | undefined): Appearance {
  return { ...DEFAULT_APPEARANCE, ...a, background: { ...DEFAULT_APPEARANCE.background, ...a?.background } };
}

export function hasBackground(a: Appearance): boolean {
  const b = a.background;
  if (b.kind === "gradient" || (b.kind === "animated" && b.animated !== "custom")) return true;
  if (b.kind === "image") return !!b.image;
  if (b.kind === "animated") return !!b.video;
  return false;
}

let lastZoom = 100;

/** Werte an <html> setzen. Idempotent und billig – darf bei jeder Änderung laufen. */
export function applyAppearance(input: Partial<Appearance> | null | undefined) {
  const a = merge(input);
  const root = document.documentElement;
  root.dataset.tone = a.tone;
  root.dataset.radius = a.radius;
  root.dataset.density = a.density;
  root.dataset.bg = hasBackground(a) ? "on" : "off";
  root.style.setProperty("--ui-accent", a.accent);
  root.style.setProperty("--ui-on-accent", onAccent(a.accent));
  root.style.setProperty("--bg-dim", String(a.background.dim / 100));
  root.style.setProperty("--bg-blur", `${a.background.blur}px`);
  setZoom(a.ui_scale);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch {
    /* egal */
  }
}

function setZoom(scale: number) {
  if (scale === lastZoom) return;
  lastZoom = scale;
  const f = scale / 100;
  if (import.meta.env.VITE_MOCK === "1") {
    // Browser-Vorschau: CSS-Zoom statt Webview-Zoom
    document.documentElement.style.zoom = String(f);
    return;
  }
  getCurrentWebview()
    .setZoom(f)
    .catch(() => {
      document.documentElement.style.zoom = String(f);
    });
}

/** Vor dem ersten Render: zuletzt benutzte Darstellung sofort anwenden (kein Aufblitzen). */
export function applyCachedAppearance() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    applyAppearance(raw ? (JSON.parse(raw) as Appearance) : DEFAULT_APPEARANCE);
  } catch {
    applyAppearance(DEFAULT_APPEARANCE);
  }
}

export function normalizeAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  return merge(a);
}

/** Bild- oder Video-Datei? (GIF/WebP laufen als Bild) */
export function isVideoFile(path: string | null | undefined): boolean {
  return !!path && /\.(mp4|webm)$/i.test(path);
}
