// Darstellung anwenden: setzt Attribute/Variablen an <html> (siehe src/styles/globals.css) und merkt sich die
// letzten Werte in localStorage, damit schon der erste Frame richtig aussieht (applyCachedAppearance in main.tsx).
// Während das Einstellungs-Popup offen ist, zeigt `useAppearanceDraft` die ungespeicherte Vorschau.
//
// Themes sind Voreinstellungen: Sie setzen mehrere Werte (Akzent, Ton, Statusfarben …) auf einmal und schalten
// Extras frei (Winter: Schneefall, Maskottchen, Frost). Danach bleibt jeder Einzelwert frei anpassbar;
// „Zurücksetzen“ stellt die Werte des gewählten Themes wieder her.
import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Appearance, BackgroundGradient, NavKey, ThemeId } from "./types";
import { onAccent } from "./color";
import { pixelScene } from "./pixelScene";

export const NAV_KEYS: NavKey[] = ["home", "instances", "servers", "social", "discover", "skins", "cosmetics", "screenshots"];

export const STATUS_DEFAULT: Appearance["status"] = { ok: "#3fe0c5", warn: "#ffb547", danger: "#ff5470" };

export const DEFAULT_APPEARANCE: Appearance = {
  design: "v1",
  theme: "standard",
  seasonal: false,
  accent: "#8b6cff",
  tone: "dark",
  radius: "square",
  radius_px: 6,
  density: "normal",
  ui_scale: 100,
  background: {
    kind: "none",
    gradient: "accent",
    animated: "aurora",
    image: null,
    video: null,
    dim: 45,
    blur: 0,
    color: "#1a1030",
    gradient_from: "#2b1655",
    gradient_to: "#ff9e6d",
    gradient_angle: 160,
  },
  font: "inter",
  headings: "default",
  font_scale: 100,
  contrast: "normal",
  cards: "flat",
  glass: 0,
  sidebar: { mode: "compact", instances: true, order: NAV_KEYS, hidden: [], style: "solid" },
  icon_size: "large",
  library_view: "grid",
  status: STATUS_DEFAULT,
  motion: "normal",
  nav_animations: true,
  app_icon: "seal",
  app_icon_color: "#8b6cff",
  app_icon_image: null,
  effects: { snow: true, snow_amount: 50, snow_settle: true, mascot: true, frost: true },
  custom_themes: [],
  active_custom: null,
};

export const ACCENT_PRESETS = ["#8b6cff", "#5aa9ff", "#3fe0c5", "#7ee07a", "#ffb547", "#ff7a45", "#ff6b9a", "#e05cff"];

// ------------------------------------------------------------------ Themes

/** Werte, die ein Theme setzt (alles andere – Schrift, Seitenleiste, Skalierung … – bleibt beim Wechsel). */
export type ThemeTokens = Pick<Appearance, "accent" | "tone" | "radius" | "contrast" | "cards" | "status"> &
  Partial<Pick<Appearance, "headings" | "font">> & { bg?: Pick<Appearance["background"], "kind" | "gradient" | "dim"> };
export type ThemeExtra = "snow" | "mascot" | "frost";

export interface ThemeDef {
  id: ThemeId;
  tokens: ThemeTokens;
  /** Extras, die nur dieses Theme hat (Schalter erscheinen im Darstellungs-Tab) */
  extras: ThemeExtra[];
  /** Farben für die Vorschau-Kachel (unabhängig von den globalen Variablen) */
  swatch: { frame: string; canvas: string; surface: string; surface2: string; text: string; muted: string };
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  standard: {
    id: "standard",
    tokens: { accent: "#8b6cff", tone: "dark", radius: "square", contrast: "normal", cards: "flat", status: STATUS_DEFAULT },
    extras: [],
    swatch: { frame: "#000000", canvas: "#070708", surface: "#0f0f11", surface2: "#161618", text: "#f4f4f6", muted: "#6d6d78" },
  },
  // Eisblauer Akzent, kühle (leicht blaue) Grautöne, Schneefall, Robbe mit Schal, Frost an Dialogkanten
  winter: {
    id: "winter",
    tokens: {
      accent: "#8fcbef",
      tone: "dark",
      radius: "square",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#7fdcc4", warn: "#f2c879", danger: "#ff7a8c" },
    },
    extras: ["snow", "mascot", "frost"],
    swatch: { frame: "#020407", canvas: "#080b10", surface: "#0e1218", surface2: "#151a22", text: "#eef4fa", muted: "#6a7686" },
  },
  // Monochrom: fast weißer Akzent auf neutralem Dunkelgrau, gedämpfte Statusfarben
  graphite: {
    id: "graphite",
    tokens: {
      accent: "#e6e6ea",
      tone: "dim",
      radius: "square",
      contrast: "normal",
      cards: "outlined",
      status: { ok: "#9ccfb4", warn: "#dcc28c", danger: "#e58e8e" },
    },
    extras: [],
    swatch: { frame: "#0b0b0d", canvas: "#111113", surface: "#18181b", surface2: "#1f1f22", text: "#f4f4f6", muted: "#77777f" },
  },
  light: {
    id: "light",
    tokens: {
      accent: "#6a4cf5",
      tone: "light",
      radius: "slight",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#086b53", warn: "#8f5300", danger: "#bd2536" },
    },
    extras: [],
    swatch: { frame: "#e7e8ee", canvas: "#f5f5f9", surface: "#ffffff", surface2: "#eeeef4", text: "#14161b", muted: "#5d6372" },
  },
  midnight: {
    id: "midnight",
    tokens: {
      accent: "#8aa0ff",
      tone: "oled",
      radius: "square",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#4fe3b5", warn: "#ffc65c", danger: "#ff6b81" },
    },
    extras: [],
    swatch: { frame: "#000000", canvas: "#00010a", surface: "#070a17", surface2: "#0d1122", text: "#f1f3fb", muted: "#8a90a8" },
  },
  ocean: {
    id: "ocean",
    tokens: {
      accent: "#3cc8ec",
      tone: "dark",
      radius: "slight",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#4fe0b0", warn: "#ffc966", danger: "#ff7187" },
    },
    extras: [],
    swatch: { frame: "#010b12", canvas: "#06131c", surface: "#0b1c27", surface2: "#112431", text: "#ecf6fb", muted: "#86a1b0" },
  },
  forest: {
    id: "forest",
    tokens: {
      accent: "#7fd36f",
      tone: "dark",
      radius: "slight",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#6ee0a0", warn: "#f0c464", danger: "#ff7a6e" },
    },
    extras: [],
    swatch: { frame: "#020a04", canvas: "#07120a", surface: "#0d1b10", surface2: "#132316", text: "#eef6ee", muted: "#8aa28c" },
  },
  sunset: {
    id: "sunset",
    tokens: {
      accent: "#ff7aa2",
      tone: "dark",
      radius: "round",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#5ee0b6", warn: "#ffcf5c", danger: "#ff6b8b" },
    },
    extras: [],
    swatch: { frame: "#0c0408", canvas: "#150a10", surface: "#1e1018", surface2: "#271620", text: "#fbf0f2", muted: "#b0909c" },
  },
  sakura: {
    id: "sakura",
    tokens: {
      accent: "#c8346f",
      tone: "light",
      radius: "round",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#086b53", warn: "#8f5300", danger: "#bd2536" },
    },
    extras: [],
    swatch: { frame: "#f5e4ea", canvas: "#fdf3f6", surface: "#fffafc", surface2: "#f8e9ee", text: "#2a1720", muted: "#76606a" },
  },
  nether: {
    id: "nether",
    tokens: {
      accent: "#ff8a3d",
      tone: "dark",
      radius: "square",
      contrast: "normal",
      cards: "flat",
      status: { ok: "#7fe08a", warn: "#ffc04d", danger: "#ff5a5f" },
    },
    extras: [],
    swatch: { frame: "#0e0202", canvas: "#170606", surface: "#210b0a", surface2: "#2b100e", text: "#fbefec", muted: "#b48f89" },
  },
  end: {
    id: "end",
    tokens: {
      accent: "#c39bff",
      tone: "dark",
      radius: "slight",
      contrast: "normal",
      cards: "outlined",
      status: { ok: "#e3dc8c", warn: "#ffb86b", danger: "#ff7398" },
    },
    extras: [],
    swatch: { frame: "#06030d", canvas: "#0d0817", surface: "#150e22", surface2: "#1c142c", text: "#f3effb", muted: "#9d92b4" },
  },
  retro: {
    id: "retro",
    tokens: {
      accent: "#ffd23f",
      tone: "dim",
      radius: "square",
      contrast: "normal",
      cards: "outlined",
      headings: "pixel",
      status: { ok: "#7ee35a", warn: "#ffb13b", danger: "#ff6155" },
    },
    extras: [],
    swatch: { frame: "#110f0b", canvas: "#181611", surface: "#201d17", surface2: "#28241d", text: "#f6f1e4", muted: "#a59d8a" },
  },
  pixel: {
    id: "pixel",
    tokens: {
      accent: "#ffb37d",
      tone: "dark",
      radius: "square",
      contrast: "normal",
      cards: "pixel",
      headings: "pixel",
      font: "inter_tight",
      bg: { kind: "gradient", gradient: "pixel", dim: 30 },
      status: { ok: "#6ee7b7", warn: "#ffd27a", danger: "#ff7b8e" },
    },
    extras: [],
    swatch: { frame: "#0f0919", canvas: "#170e26", surface: "#221934", surface2: "#2c2241", text: "#f6f3ff", muted: "#a59fba" },
  },
  pixel_light: {
    id: "pixel_light",
    tokens: {
      accent: "#6a4cf5",
      tone: "light",
      radius: "square",
      contrast: "normal",
      cards: "pixel",
      headings: "pixel",
      font: "inter_tight",
      status: { ok: "#08766a", warn: "#875000", danger: "#c81e45" },
    },
    extras: [],
    swatch: { frame: "#e9e7e1", canvas: "#f5f4f1", surface: "#fffefc", surface2: "#f0efeb", text: "#151419", muted: "#5b5963" },
  },
  contrast: {
    id: "contrast",
    tokens: {
      accent: "#ffd60a",
      tone: "oled",
      radius: "square",
      contrast: "high",
      cards: "outlined",
      status: { ok: "#3dff9a", warn: "#ffb020", danger: "#ff6b6b" },
    },
    extras: [],
    swatch: { frame: "#000000", canvas: "#000000", surface: "#0a0a0a", surface2: "#151515", text: "#ffffff", muted: "#d6d6dc" },
  },
};
export const THEME_IDS: ThemeId[] = ["standard", "pixel", "pixel_light", "light", "graphite", "midnight", "ocean", "forest", "sunset", "sakura", "nether", "end", "retro", "contrast", "winter"];

/** Theme wählen: setzt dessen Werte, lässt Layout/Schrift/Hintergrund-Datei usw. unverändert. */
export function applyTheme(a: Appearance, id: ThemeId): Appearance {
  const th = THEMES[id] ?? THEMES.standard;
  const prev = (THEMES[a.theme] ?? THEMES.standard).tokens;
  const { bg, ...tk } = th.tokens;
  const background = bg
    ? { ...a.background, ...bg }
    : prev.bg && a.background.kind === prev.bg.kind && a.background.gradient === prev.bg.gradient
      ? { ...a.background, kind: DEFAULT_APPEARANCE.background.kind, dim: DEFAULT_APPEARANCE.background.dim }
      : a.background;
  return {
    ...a,
    ...tk,
    theme: th.id,
    headings: tk.headings ?? (prev.headings ? DEFAULT_APPEARANCE.headings : a.headings),
    font: tk.font ?? (prev.font ? DEFAULT_APPEARANCE.font : a.font),
    status: { ...tk.status },
    background,
    active_custom: null,
  };
}

/** Weicht die Darstellung von den Werten ihres Themes ab? (für „angepasst“ + Zurücksetzen) */
export function isThemeModified(a: Appearance): boolean {
  const tk = (THEMES[a.theme] ?? THEMES.standard).tokens;
  return (
    (tk.headings !== undefined && a.headings !== tk.headings) ||
    (tk.font !== undefined && a.font !== tk.font) ||
    a.accent.toLowerCase() !== tk.accent ||
    a.tone !== tk.tone ||
    a.radius !== tk.radius ||
    a.contrast !== tk.contrast ||
    a.cards !== tk.cards ||
    a.status.ok !== tk.status.ok ||
    a.status.warn !== tk.status.warn ||
    a.status.danger !== tk.status.danger
  );
}

/** Saisonal: im Dezember und Januar wird aus „Standard“ automatisch „Winter“. */
export function isWinterSeason(d = new Date()): boolean {
  const m = d.getMonth();
  return m === 11 || m === 0;
}

/** Was tatsächlich angezeigt wird (saisonales Theme eingerechnet). */
export function effectiveAppearance(a: Appearance, now = new Date()): Appearance {
  if (a.seasonal && a.theme === "standard" && isWinterSeason(now)) return applyTheme(a, "winter");
  return a;
}

/** Hat das angezeigte Theme dieses Extra – und ist es eingeschaltet? */
export function themeExtra(a: Appearance, extra: ThemeExtra): boolean {
  return (THEMES[a.theme]?.extras ?? []).includes(extra) && a.effects[extra];
}

// ------------------------------------------------------------------ Hintergrund-Verläufe

/** Statische Verläufe. `a` = Akzentfarbe. */
export const GRADIENTS: Record<Exclude<BackgroundGradient, "custom">, (a: string) => string> = {
  pixel: (a) => pixelScene(a),
  accent: (a) =>
    `radial-gradient(90% 70% at 12% 0%, color-mix(in srgb, ${a} 42%, transparent), transparent 70%), radial-gradient(70% 60% at 100% 100%, color-mix(in srgb, ${a} 22%, transparent), transparent 70%), #0b0b10`,
  dusk: () => "radial-gradient(80% 70% at 10% 0%, #5b2fd0aa, transparent 70%), radial-gradient(80% 70% at 100% 100%, #d0367a88, transparent 70%), linear-gradient(160deg, #120c24, #1a0b18)",
  ocean: () => "radial-gradient(80% 70% at 0% 100%, #0f6f8a99, transparent 70%), radial-gradient(70% 60% at 100% 0%, #2a4fd088, transparent 70%), linear-gradient(160deg, #06121c, #070b1a)",
  ember: () => "radial-gradient(80% 70% at 100% 0%, #d0582a99, transparent 70%), radial-gradient(70% 60% at 0% 100%, #8a1f3a88, transparent 70%), linear-gradient(160deg, #1a0d08, #140609)",
  forest: () => "radial-gradient(80% 70% at 0% 0%, #2f8a4a99, transparent 70%), radial-gradient(70% 60% at 100% 100%, #1f6a6a88, transparent 70%), linear-gradient(160deg, #07130b, #06110f)",
};

/** CSS-Hintergrund für „Farbe“ und „Verlauf“ (null = kein reiner CSS-Hintergrund). */
export function backgroundCss(b: Appearance["background"], accent: string): string | null {
  if (b.kind === "color") return b.color;
  if (b.kind !== "gradient") return null;
  if (b.gradient === "custom") return `linear-gradient(${b.gradient_angle}deg, ${b.gradient_from}, ${b.gradient_to})`;
  return (GRADIENTS[b.gradient] ?? GRADIENTS.accent)(accent);
}

const CACHE_KEY = "vl.appearance";

/** Ungespeicherte Vorschau aus dem Einstellungs-Tab (null = gespeicherte Werte). */
export const useAppearanceDraft = create<{ draft: Appearance | null }>(() => ({ draft: null }));

/** Zuletzt angewendete (effektive) Darstellung – für Komponenten, die Theme-Extras zeigen (Schnee, Maskottchen …). */
export const useLiveAppearance = create<{ a: Appearance }>(() => ({ a: DEFAULT_APPEARANCE }));

function merge(a: Partial<Appearance> | null | undefined): Appearance {
  const d = DEFAULT_APPEARANCE;
  const sb = { ...d.sidebar, ...a?.sidebar };
  // Reihenfolge: bekannte Einträge, jeder einmal, fehlende hinten anhängen
  const order = [...(sb.order ?? []), ...NAV_KEYS].filter((k, i, arr): k is NavKey => NAV_KEYS.includes(k) && arr.indexOf(k) === i);
  return {
    ...d,
    ...a,
    background: { ...d.background, ...a?.background },
    sidebar: {
      ...sb,
      order,
      hidden: (sb.hidden ?? []).filter((k) => NAV_KEYS.includes(k) && k !== "home"),
      style: sb.style === "floating" || sb.style === "tinted" ? sb.style : "solid",
    },
    radius_px: clampNum(a?.radius_px, 0, 24, d.radius_px),
    glass: clampNum(a?.glass, 0, 100, d.glass),
    custom_themes: Array.isArray(a?.custom_themes) ? a.custom_themes : [],
    active_custom: typeof a?.active_custom === "string" ? a.active_custom : null,
    status: { ...d.status, ...a?.status },
    effects: { ...d.effects, ...a?.effects },
    theme: a?.theme && Object.hasOwn(THEMES, a.theme) ? a.theme : d.theme,
    design: a?.design === "v2" ? "v2" : "v1",
  };
}

function clampNum(v: unknown, min: number, max: number, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
}

export function hasBackground(a: Appearance): boolean {
  const b = a.background;
  if (b.kind === "gradient" || b.kind === "color" || (b.kind === "animated" && b.animated !== "custom")) return true;
  if (b.kind === "image") return !!b.image;
  if (b.kind === "animated") return !!b.video;
  return false;
}

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
    document.documentElement.style.zoom = String(f);
    return;
  }
  getCurrentWebview()
    .setZoom(f)
    .catch(() => {
      document.documentElement.style.zoom = String(f);
    });
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

export function normalizeAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  return merge(a);
}

/** Bild- oder Video-Datei? (GIF/WebP laufen als Bild) */
export function isVideoFile(path: string | null | undefined): boolean {
  return !!path && /\.(mp4|webm)$/i.test(path);
}

// ------------------------------------------------------------------ Frost (Winter)

/**
 * Eisblumen an einer oberen Dialogecke als Pixel-SVG (1-px-Linien): Kristalle wachsen von Ober- und Seitenkante
 * schräg nach innen und verzweigen sich wie Farnwedel; nahe der Ecke dichter und länger, nach außen schnell
 * spärlicher und blasser. Deterministisch, als CSS-url().
 */
function frostSvg(mirror: boolean): string {
  const W = 120,
    H = 72;
  let s = 48271;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const px = new Map<number, number>(); // y*W+x -> Deckkraft
  const plot = (x: number, y: number, o: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    px.set(k, Math.max(px.get(k) ?? 0, o));
  };
  // Ein Kristallast: diagonal (dx/dy je ±1/0), mit kurzen Seitenzweigen im 45°-Winkel
  const grow = (x: number, y: number, dx: number, dy: number, len: number, o: number, depth: number) => {
    for (let i = 0; i < len; i++) {
      x += dx;
      y += dy;
      const fade = o * (1 - (i / len) * 0.6);
      plot(x, y, fade);
      if (depth < 2 && i > 0 && i % 2 === 0 && r() < 0.55) {
        // Zweig im 45°-Winkel zur Hauptrichtung, etwa halb so lang wie der Rest des Asts
        const side = r() < 0.5 ? 1 : -1;
        const [bx, by] = dx !== 0 && dy !== 0 ? (side > 0 ? [dx, 0] : [0, dy]) : dx === 0 ? [side, dy] : [dx, side];
        grow(x, y, bx, by, Math.max(1, Math.round((len - i) * 0.45)), fade * 0.8, depth + 1);
      }
    }
  };
  // Oberkante: Keime werden nach außen seltener, Äste kürzer
  for (let x = 0; x < W; x++) {
    const d = x / W;
    if (r() < 0.32 * Math.exp(-d * 3.2)) {
      const len = Math.round(3 + (1 - d) * 11 * (0.5 + r()));
      const dir = r();
      grow(x, 0, dir < 0.4 ? 1 : dir < 0.8 ? -1 : 0, 1, len, 0.75 - d * 0.45, 0);
    }
  }
  // Seitenkante
  for (let y = 0; y < H; y++) {
    const d = y / H;
    if (r() < 0.3 * Math.exp(-d * 3.4)) {
      const len = Math.round(3 + (1 - d) * 9 * (0.5 + r()));
      const dir = r();
      grow(0, y, 1, dir < 0.4 ? 1 : dir < 0.8 ? -1 : 0, len, 0.7 - d * 0.45, 0);
    }
  }
  // Ein paar einzelne Reifkörner direkt an der Kante
  for (let x = 0; x < W * 0.6; x++) if (r() < 0.18 * (1 - x / (W * 0.6))) plot(x, 0, 0.5);
  const rects: string[] = [];
  for (const [k, o] of px) {
    const y = Math.floor(k / W),
      x = k % W;
    rects.push(`<rect x='${mirror ? W - 1 - x : x}' y='${y}' width='1' height='1' fill-opacity='${o.toFixed(2)}'/>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' shape-rendering='crispEdges' fill='%23e4f4ff'>${rects.join("")}</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}")`;
}
