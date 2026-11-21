import type { Appearance, NavKey } from "../types";
import { DEFAULT_APPEARANCE, NAV_KEYS } from "./defaults";
import { THEMES } from "./themes";

export function merge(a: Partial<Appearance> | null | undefined): Appearance {
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

export function normalizeAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  return merge(a);
}
