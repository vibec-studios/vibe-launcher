import type { Appearance, CustomTheme, ThemeValues } from "./types";
import type { ThemeDoc } from "./themes/document";
import { exportCode as docCode, exportFile as docFile, revision } from "./themes/document";
import { validateValues } from "./themes/values";
import { MAX_NAME } from "./themes/rules";

export { FILE_EXT, FILE_FORMAT, MAX_NAME, LIMITS } from "./themes/rules";
export { ThemeImportError } from "./themes/report";
export type { ThemeWarning } from "./themes/report";
export { cleanName, hasExtension, isV2, parseThemeInput } from "./themes/document";
export type { ParsedTheme, ThemeDoc } from "./themes/document";
export { validateValues } from "./themes/values";

export const MAX_CUSTOM_THEMES = 24;

export type ThemeExtension = Pick<ThemeDoc, "css" | "slots" | "author" | "description">;

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

export function uniqueName(name: string, list: CustomTheme[]): string {
  const taken = new Set(list.map((t) => t.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const n = `${name.slice(0, MAX_NAME - 4)} (${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return name;
}

export function themeDoc(ct: CustomTheme, ext: ThemeExtension | null): ThemeDoc {
  const doc: ThemeDoc = { name: ct.name, values: ct.values, palette: { ...ct.palette }, css: ext?.css ?? "", slots: { ...ext?.slots } };
  if (ext?.author) doc.author = ext.author;
  if (ext?.description) doc.description = ext.description;
  return doc;
}

export function extensionOf(doc: ThemeDoc): ThemeExtension | null {
  const ext: ThemeExtension = { css: doc.css, slots: doc.slots, author: doc.author, description: doc.description };
  return ext.css || Object.keys(ext.slots).length || ext.author || ext.description ? ext : null;
}

export function extRevision(ext: ThemeExtension): string {
  return revision(ext);
}

export function exportCode(ct: CustomTheme, ext: ThemeExtension | null = null): string {
  return docCode(themeDoc(ct, ext));
}

export function exportFile(ct: CustomTheme, ext: ThemeExtension | null = null): string {
  return docFile(themeDoc(ct, ext));
}

export function fileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || "theme"}.vibetheme`;
}
