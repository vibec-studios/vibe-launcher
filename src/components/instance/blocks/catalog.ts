import { shade } from "./color";
import { FLAT_DESIGNS } from "./flat";
import { ISO_DESIGNS } from "./iso";
import type { Design } from "./types";

export const DESIGNS: Design[] = [...ISO_DESIGNS, ...FLAT_DESIGNS];
const BY_ID = new Map(DESIGNS.map((d) => [d.id, d]));
const AUTO_POOL = ISO_DESIGNS.filter((d) => !d.legacy);

export const BACKGROUNDS = ["accent", "sky", "night", "sunset", "forest", "stone"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export function backgroundCss(bg: Background | null, accent: string): string | undefined {
  switch (bg) {
    case "accent":
      return `linear-gradient(160deg, ${shade(accent, 0.08)}, ${shade(accent, -0.55)})`;
    case "sky":
      return "linear-gradient(180deg, #7cc4f5, #d4eeff)";
    case "night":
      return "linear-gradient(180deg, #252c60, #0c0f27)";
    case "sunset":
      return "linear-gradient(160deg, #ffb36b, #c2456b 60%, #4a2a6b)";
    case "forest":
      return "linear-gradient(180deg, #6fb05f, #2a5527)";
    case "stone":
      return "linear-gradient(180deg, #6a6f76, #313439)";
    default:
      return undefined;
  }
}

export interface BlockIcon {
  design: Design;
  bg: Background | null;
}

const RE = /^block:([a-z0-9-]{1,32})(?:@([a-z0-9-]{1,16}))?$/;

export function isBlockIcon(icon: string | null | undefined): icon is string {
  return !!icon && icon.startsWith("block:");
}

export function parseBlockIcon(icon: string | null | undefined, seed?: string): BlockIcon | null {
  if (!isBlockIcon(icon)) return null;
  const m = RE.exec(icon);
  const design = (m && BY_ID.get(m[1])) || autoDesign(seed ?? icon);
  const bg = m?.[2] && (BACKGROUNDS as readonly string[]).includes(m[2]) ? (m[2] as Background) : null;
  return { design, bg };
}

export function formatBlockIcon(design: string, bg: Background | null): string {
  return bg ? `block:${design}@${bg}` : `block:${design}`;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function autoDesign(seed: string): Design {
  return AUTO_POOL[hash(seed) % AUTO_POOL.length];
}

export function randomBlockIcon(): string {
  return formatBlockIcon(AUTO_POOL[Math.floor(Math.random() * AUTO_POOL.length)].id, null);
}
