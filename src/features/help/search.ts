import type { GuideText } from "./types";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function matchGuide(g: GuideText, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm([g.title, g.summary, g.keywords ?? "", ...g.steps, ...(g.tips ?? [])].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
