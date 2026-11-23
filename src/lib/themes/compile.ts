import type { ThemeDoc } from "./document.ts";
import { Report } from "./report.ts";
import type { SlotName } from "./rules.ts";
import { SLOTS } from "./rules.ts";
import { fontMap, keyframeMap, sanitizeCss } from "./css/sanitize.ts";
import type { MNode } from "./markup/sanitize.ts";
import { sanitizeMarkup } from "./markup/sanitize.ts";
import { compileMarkup, placeholdersOf } from "./markup/compile.ts";

export interface CompiledTheme {
  css: string;
  slots: Partial<Record<SlotName, MNode[]>>;
  placeholders: string[];
}

export function compileTheme(doc: Pick<ThemeDoc, "css" | "slots">, mode: "scoped" | "preview"): CompiledTheme {
  const report = new Report();
  const css = sanitizeCss(doc.css, mode, report);
  const maps = { keyframes: keyframeMap(doc.css, mode), fonts: fontMap(doc.css, mode) };
  const budget = { total: 0 };
  const slots: Partial<Record<SlotName, MNode[]>> = {};
  const ph = new Set<string>();
  for (const s of SLOTS) {
    const src = doc.slots[s];
    if (!src) continue;
    const nodes = compileMarkup(sanitizeMarkup(src, report, budget), mode, maps, report);
    if (!nodes.length) continue;
    slots[s] = nodes;
    placeholdersOf(nodes, ph);
  }
  return { css, slots, placeholders: [...ph] };
}
