import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Appearance } from "../types";
import { onAccent } from "../color";
import { DEFAULT_APPEARANCE } from "./defaults";
import { effectiveAppearance, themeExtra } from "./themeUtils";
import { hasBackground } from "./background";
import { merge } from "./normalize";
import { frostSvg } from "./frost";

const CACHE_KEY = "vl.appearance";

/** Ungespeicherte Vorschau aus dem Einstellungs-Tab (null = gespeicherte Werte). */
export const useAppearanceDraft = create<{ draft: Appearance | null }>(() => ({ draft: null }));

/** Zuletzt angewendete (effektive) Darstellung – für Komponenten, die Theme-Extras zeigen (Schnee, Maskottchen …). */
export const useLiveAppearance = create<{ a: Appearance }>(() => ({ a: DEFAULT_APPEARANCE }));

let lastZoom = 100;

/** Werte an <html> setzen. Idempotent und billig – darf bei jeder Änderung laufen. */
export function applyAppearance(input: Partial<Appearance> | null | undefined) {
  const saved = merge(input);
  const a = effectiveAppearance(saved);
  const root = document.documentElement;
  const ds = root.dataset;
  ds.design = a.design;
  ds.theme = a.theme;
  ds.tone = a.tone;
  ds.radius = a.radius;
  ds.density = a.density;
  ds.contrast = a.contrast;
  ds.cards = a.cards;
  ds.font = a.font;
  ds.headings = a.headings;
  ds.sidebar = a.sidebar.mode;
  ds.icons = a.icon_size;
  ds.motion = a.motion;
  ds.nav = a.nav_animations ? "on" : "off";
  ds.frost = themeExtra(a, "frost") ? "on" : "off";
  ds.bg = hasBackground(a) ? "on" : "off";
  ds.glass = a.glass > 0 ? "on" : "off";
  ds.rail = a.sidebar.style;
  const st = root.style;
  st.setProperty("--ui-accent", a.accent);
  st.setProperty("--ui-on-accent", onAccent(a.accent));
  st.setProperty("--ui-ok", a.status.ok);
  st.setProperty("--ui-warn", a.status.warn);
  st.setProperty("--ui-danger", a.status.danger);
  st.setProperty("--font-scale", String(Math.min(115, Math.max(90, a.font_scale)) / 100));
  st.setProperty("--bg-dim", String(a.background.dim / 100));
  st.setProperty("--bg-blur", `${a.background.blur}px`);
  st.setProperty("--r-custom", `${a.radius_px}px`);
  st.setProperty("--glass", String(a.glass / 100));
  if (ds.frost === "on" && !st.getPropertyValue("--frost-l")) {
    st.setProperty("--frost-l", frostSvg(false));
    st.setProperty("--frost-r", frostSvg(true));
  }
  setZoom(a.ui_scale);
  useLiveAppearance.setState({ a });
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
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
    setCssZoom(f);
    return;
  }
  getCurrentWebview()
    .setZoom(f)
    .then(() => setCssZoom(1))
    .catch(() => setCssZoom(f));
}

function setCssZoom(f: number) {
  const root = document.documentElement;
  root.style.zoom = f === 1 ? "" : String(f);
  root.style.setProperty("--ui-zoom", String(f));
  root.toggleAttribute("data-css-zoom", f !== 1);
}

/** Zuletzt gespeicherte Darstellung (ohne saisonales Theme) – z. B. Standardansicht der Bibliothek. */
export function cachedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return merge(raw ? (JSON.parse(raw) as Appearance) : null);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Vor dem ersten Render: zuletzt benutzte Darstellung sofort anwenden (kein Aufblitzen). */
export function applyCachedAppearance() {
  applyAppearance(cachedAppearance());
}
