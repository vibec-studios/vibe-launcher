import type { Appearance, BackgroundGradient } from "../types";
import { pixelScene } from "../pixelScene";

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

export function hasBackground(a: Appearance): boolean {
  const b = a.background;
  if (b.kind === "gradient" || b.kind === "color" || (b.kind === "animated" && b.animated !== "custom")) return true;
  if (b.kind === "image") return !!b.image;
  if (b.kind === "animated") return !!b.video;
  return false;
}

/** Bild- oder Video-Datei? (GIF/WebP laufen als Bild) */
export function isVideoFile(path: string | null | undefined): boolean {
  return !!path && /\.(mp4|webm)$/i.test(path);
}
