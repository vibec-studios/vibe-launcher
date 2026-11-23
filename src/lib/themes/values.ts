import type { ThemeId, ThemeValues } from "../types";
import { DEFAULT_APPEARANCE } from "../appearance/defaults.ts";
import { THEMES } from "../appearance/themes.ts";
import { ThemeImportError } from "./report.ts";

export const ENUMS = {
  tone: ["dark", "dim", "oled", "light"],
  radius: ["square", "slight", "round", "custom"],
  contrast: ["normal", "high"],
  cards: ["flat", "outlined", "raised", "pixel"],
  headings: ["default", "pixel", "pixel_all"],
  font: ["inter", "inter_tight", "system", "mono"],
  sidebar_style: ["solid", "floating", "tinted"],
  kind: ["none", "color", "gradient", "image", "animated"],
  gradient: ["accent", "dusk", "ocean", "ember", "forest", "pixel", "custom"],
  animated: ["aurora", "particles", "waves", "blocks"],
} as const;

const HEX = /^#[0-9a-f]{6}$/;

function hex(v: unknown, def: string): string {
  if (v === undefined) return def;
  if (typeof v !== "string") throw new ThemeImportError("values");
  const h = v.trim().toLowerCase();
  const full = h.startsWith("#") ? h : `#${h}`;
  if (!HEX.test(full)) throw new ThemeImportError("values");
  return full;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  if (v === undefined) return def;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new ThemeImportError("values");
  return v as T;
}

function num(v: unknown, min: number, max: number, def: number): number {
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ThemeImportError("values");
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function obj(v: unknown): Record<string, unknown> {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ThemeImportError("values");
  return v as Record<string, unknown>;
}

export function validateValues(raw: unknown): ThemeValues {
  const v = obj(raw);
  const d = DEFAULT_APPEARANCE;
  const st = obj(v.status);
  const bg = obj(v.background);
  const db = d.background;
  const theme = v.theme === undefined ? d.theme : typeof v.theme === "string" && Object.hasOwn(THEMES, v.theme) ? (v.theme as ThemeId) : null;
  if (!theme) throw new ThemeImportError("values");
  return {
    theme,
    accent: hex(v.accent, d.accent),
    tone: pick(v.tone, ENUMS.tone, d.tone),
    radius: pick(v.radius, ENUMS.radius, d.radius),
    radius_px: num(v.radius_px, 0, 24, d.radius_px),
    contrast: pick(v.contrast, ENUMS.contrast, d.contrast),
    cards: pick(v.cards, ENUMS.cards, d.cards),
    headings: pick(v.headings, ENUMS.headings, d.headings),
    font: pick(v.font, ENUMS.font, d.font),
    font_scale: num(v.font_scale, 90, 115, d.font_scale),
    status: { ok: hex(st.ok, d.status.ok), warn: hex(st.warn, d.status.warn), danger: hex(st.danger, d.status.danger) },
    glass: num(v.glass, 0, 100, d.glass),
    sidebar_style: pick(v.sidebar_style, ENUMS.sidebar_style, d.sidebar.style),
    background: {
      kind: pick(bg.kind === "image" ? "none" : bg.kind, ENUMS.kind, db.kind),
      gradient: pick(bg.gradient, ENUMS.gradient, db.gradient),
      animated: pick(bg.animated === "custom" ? "aurora" : bg.animated, ENUMS.animated, "aurora"),
      color: hex(bg.color, db.color),
      gradient_from: hex(bg.gradient_from, db.gradient_from),
      gradient_to: hex(bg.gradient_to, db.gradient_to),
      gradient_angle: num(bg.gradient_angle, 0, 360, db.gradient_angle),
      dim: num(bg.dim, 0, 90, db.dim),
      blur: num(bg.blur, 0, 40, db.blur),
      image: null,
    },
  };
}

export function portableValues(v: ThemeValues): Omit<ThemeValues, "background"> & { background: Omit<ThemeValues["background"], "image"> } {
  const { image: _img, ...background } = v.background;
  return { ...v, background: { ...background, kind: background.kind === "image" ? "none" : background.kind } };
}
