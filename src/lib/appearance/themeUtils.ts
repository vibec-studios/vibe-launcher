import type { Appearance, ThemeId } from "../types";
import { DEFAULT_APPEARANCE } from "./defaults";
import { THEMES, type ThemeExtra } from "./themes";

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
