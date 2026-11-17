// CSS-Variablen für eine lokale Akzentfarbe. `--color-accent` muss mitgesetzt werden: Tailwind-Utilities wie
// `bg-accent` lesen `var(--color-accent)`, das sonst schon an :root zur globalen Farbe aufgelöst ist.
import type { CSSProperties } from "react";
import { onAccent } from "@/lib/format";

export function accentVars(color: string): CSSProperties {
  return { "--accent": color, "--color-accent": color, "--on-accent": onAccent(color) } as CSSProperties;
}
