import type { Message } from "@/lib/vibe-sdk";

export const GROUP_GAP_MS = 5 * 60_000;

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(document.documentElement.lang || "de", { hour: "2-digit", minute: "2-digit" });
}
export function dayOf(iso: string, t: (k: string) => string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t("social.chat.today");
  if (d.toDateString() === yest.toDateString()) return t("social.chat.yesterday");
  return d.toLocaleDateString(document.documentElement.lang || "de", { weekday: "long", day: "numeric", month: "long" });
}

/** Nur Emojis (1–3, ohne sonstigen Text) -> groß darstellen. */
export const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;

/** Eigene Blasen: Akzentfarbe flach abgemischt (kein Verlauf). */
export const MINE_BG = "bg-[color-mix(in_srgb,var(--ui-accent)_26%,var(--surface-2))]";

export type Row = { kind: "top" } | { kind: "day"; key: string; label: string } | { kind: "msg"; m: Message; head: boolean; tail: boolean };
