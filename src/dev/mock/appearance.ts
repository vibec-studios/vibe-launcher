import type { Appearance, CustomTheme, Settings, ThemeId } from "@/lib/types";
import { DEFAULT_APPEARANCE, THEMES, applyTheme } from "@/lib/appearance";
import type { Handlers } from "./util";

function flag(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

const SAMPLES: CustomTheme[] = [
  {
    id: "mock-sunrise",
    name: "Pixel-Morgen",
    values: {
      theme: "pixel",
      accent: "#ffd774",
      tone: "dark",
      radius: "square",
      radius_px: 6,
      contrast: "normal",
      cards: "pixel",
      headings: "pixel_all",
      font: "inter_tight",
      font_scale: 100,
      status: { ok: "#6ee7b7", warn: "#ffd27a", danger: "#ff7b8e" },
      glass: 0,
      sidebar_style: "tinted",
      background: { ...DEFAULT_APPEARANCE.background, kind: "gradient", gradient: "pixel", dim: 25, image: null },
    },
  },
  {
    id: "mock-glass",
    name: "Glas Ozean",
    values: {
      theme: "ocean",
      accent: "#3cc8ec",
      tone: "dark",
      radius: "custom",
      radius_px: 12,
      contrast: "normal",
      cards: "raised",
      headings: "default",
      font: "inter",
      font_scale: 100,
      status: { ok: "#4fe0b0", warn: "#ffc966", danger: "#ff7187" },
      glass: 60,
      sidebar_style: "floating",
      background: { ...DEFAULT_APPEARANCE.background, kind: "gradient", gradient: "custom", gradient_from: "#0e1629", gradient_to: "#3a8fb0", dim: 20, image: null },
    },
  },
];

export function mockAppearance(): Settings["appearance"] {
  let a: Appearance = { ...DEFAULT_APPEARANCE, design: flag("vl.mock.design") === "v2" ? "v2" : "v1" };
  const theme = flag("vl.mock.theme");
  if (theme && Object.hasOwn(THEMES, theme)) a = applyTheme(a, theme as ThemeId);
  if (flag("vl.mock.custom") === "1") a = { ...a, custom_themes: SAMPLES };
  return { ...a, ...((globalThis as { __VL_MOCK_APPEARANCE?: Partial<Appearance> }).__VL_MOCK_APPEARANCE ?? {}) };
}

const files = new Map<string, string>();

export default {
  appearance_theme_write: ({ path, content }) => {
    files.set(path as string, content as string);
    return null;
  },
  appearance_theme_read: ({ path }) => files.get(path as string) ?? "",
} satisfies Handlers;
