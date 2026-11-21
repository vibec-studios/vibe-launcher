import type { Appearance, CustomTheme, ThemeId, ThemeValues } from "./types";
import { DEFAULT_APPEARANCE, THEMES } from "./appearance";

export const MAX_CUSTOM_THEMES = 24;
export const MAX_NAME = 40;
export const CODE_PREFIX = "VIBE-THEME-1:";
export const FILE_FORMAT = "vibe-launcher-theme";
export const FILE_EXT = "vibetheme";
const MAX_INPUT = 20_000;

const ENUMS = {
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

export class ThemeImportError extends Error {
  constructor(public code: "empty" | "too_long" | "format" | "version" | "values") {
    super(code);
  }
}

export function snapshot(a: Appearance): ThemeValues {
  const b = a.background;
  return {
    theme: a.theme,
    accent: a.accent.toLowerCase(),
    tone: a.tone,
    radius: a.radius,
    radius_px: a.radius_px,
    contrast: a.contrast,
    cards: a.cards,
    headings: a.headings,
    font: a.font,
    font_scale: a.font_scale,
    status: { ...a.status },
    glass: a.glass,
    sidebar_style: a.sidebar.style,
    background: {
      kind: b.kind,
      gradient: b.gradient,
      animated: b.animated === "custom" ? "aurora" : b.animated,
      color: b.color,
      gradient_from: b.gradient_from,
      gradient_to: b.gradient_to,
      gradient_angle: b.gradient_angle,
      dim: b.dim,
      blur: b.blur,
      image: b.kind === "image" ? b.image : null,
    },
  };
}

export function applyCustom(a: Appearance, ct: CustomTheme): Appearance {
  const v = ct.values;
  const { image, ...bg } = v.background;
  const img = image ?? a.background.image;
  const kind = bg.kind === "image" && !img ? "none" : bg.kind;
  return {
    ...a,
    theme: v.theme,
    accent: v.accent,
    tone: v.tone,
    radius: v.radius,
    radius_px: v.radius_px,
    contrast: v.contrast,
    cards: v.cards,
    headings: v.headings,
    font: v.font,
    font_scale: v.font_scale,
    status: { ...v.status },
    glass: v.glass,
    sidebar: { ...a.sidebar, style: v.sidebar_style },
    background: { ...a.background, ...bg, kind, image: img },
    active_custom: ct.id,
  };
}

function canon(v: ThemeValues): string {
  try {
    return JSON.stringify(validateValues(v));
  } catch {
    return "";
  }
}

export function isCustomModified(a: Appearance, ct: CustomTheme): boolean {
  return canon(snapshot(a)) !== canon(ct.values);
}

export function newThemeId(): string {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function cleanName(name: string, fallback: string): string {
  const n = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME);
  return n || fallback;
}

export function uniqueName(name: string, list: CustomTheme[]): string {
  const taken = new Set(list.map((t) => t.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const n = `${name.slice(0, MAX_NAME - 4)} (${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return name;
}

interface ThemeFile {
  format: typeof FILE_FORMAT;
  version: 1;
  name: string;
  values: Omit<ThemeValues, "background"> & { background: Omit<ThemeValues["background"], "image"> };
}

function portable(name: string, v: ThemeValues): ThemeFile {
  const { image: _img, ...background } = v.background;
  return {
    format: FILE_FORMAT,
    version: 1,
    name,
    values: { ...v, background: { ...background, kind: background.kind === "image" ? "none" : background.kind } },
  };
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64decode(code: string): string {
  const norm = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "===".slice((norm.length + 3) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function exportCode(ct: CustomTheme): string {
  return CODE_PREFIX + b64encode(JSON.stringify(portable(ct.name, ct.values)));
}

export function exportFile(ct: CustomTheme): string {
  return `${JSON.stringify(portable(ct.name, ct.values), null, 2)}\n`;
}

export function fileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || "theme"}.${FILE_EXT}`;
}

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

function obj(v: unknown): Record<string, unknown> {
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

export function parseThemeInput(input: string, fallbackName: string): { name: string; values: ThemeValues } {
  const text = input.trim();
  if (!text) throw new ThemeImportError("empty");
  if (text.length > MAX_INPUT) throw new ThemeImportError("too_long");
  let json: string;
  if (text.toUpperCase().startsWith(CODE_PREFIX)) {
    try {
      json = b64decode(text.slice(CODE_PREFIX.length).replace(/\s+/g, ""));
    } catch {
      throw new ThemeImportError("format");
    }
  } else if (text.startsWith("{")) {
    json = text;
  } else {
    throw new ThemeImportError("format");
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ThemeImportError("format");
  }
  const f = obj(data);
  if (f.format !== FILE_FORMAT) throw new ThemeImportError("format");
  if (f.version !== 1) throw new ThemeImportError("version");
  return { name: cleanName(typeof f.name === "string" ? f.name : "", fallbackName), values: validateValues(f.values) };
}
