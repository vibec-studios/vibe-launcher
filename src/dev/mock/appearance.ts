import type { Appearance, CustomTheme, Settings, ThemeId } from "@/lib/types";
import { DEFAULT_APPEARANCE, THEMES, applyTheme } from "@/lib/appearance";
import { applyCustom, extRevision, extensionOf, parseThemeInput } from "@/lib/customThemes";
import ironMan from "../../../skills/vibe-launcher-theme/examples/Iron Man.vibetheme?raw";
import calmLake from "../../../skills/vibe-launcher-theme/examples/Stiller See.vibetheme?raw";
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

const V2_SAMPLES: Record<string, { id: string; content: string }> = {
  ironman: { id: "mock-ironman", content: ironMan },
  calm: { id: "mock-calm", content: calmLake },
};
const extFiles = new Map<string, string>(Object.values(V2_SAMPLES).map((s) => [s.id, s.content]));

function v2Sample(key: string): CustomTheme | null {
  const s = V2_SAMPLES[key];
  if (!s) return null;
  const { doc } = parseThemeInput(s.content, key);
  const ext = extensionOf(doc);
  return { id: s.id, name: doc.name, values: doc.values, palette: doc.palette, ext: ext ? extRevision(ext) : null };
}

export function mockAppearance(): Settings["appearance"] {
  let a: Appearance = { ...DEFAULT_APPEARANCE, design: flag("vl.mock.design") === "v2" ? "v2" : "v1" };
  const theme = flag("vl.mock.theme");
  if (theme && Object.hasOwn(THEMES, theme)) a = applyTheme(a, theme as ThemeId);
  if (flag("vl.mock.custom") === "1") a = { ...a, custom_themes: SAMPLES };
  const v2 = v2Sample(flag("vl.mock.theme2") ?? "");
  if (v2) a = applyCustom({ ...a, custom_themes: [...a.custom_themes, v2] }, v2);
  return { ...a, ...((globalThis as { __VL_MOCK_APPEARANCE?: Partial<Appearance> }).__VL_MOCK_APPEARANCE ?? {}) };
}

const files = new Map<string, string>();

export default {
  appearance_theme_write: ({ path, content }) => {
    files.set(path as string, content as string);
    return null;
  },
  appearance_theme_read: ({ path }) => files.get(path as string) ?? "",
  appearance_theme_ext_save: ({ id, content }) => {
    extFiles.set(id as string, content as string);
    return null;
  },
  appearance_theme_ext_load: ({ id }) => extFiles.get(id as string) ?? null,
  appearance_theme_ext_delete: ({ id }) => {
    extFiles.delete(id as string);
    return null;
  },
  appearance_theme_ext_prune: () => 0,
} satisfies Handlers;
