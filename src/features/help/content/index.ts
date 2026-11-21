import { localeExtra, useLang, type Lang } from "@/i18n";
import type { HelpContent } from "../types";
import de from "./de";
import en from "./en";

function withFallback(loc: Partial<HelpContent> | undefined): HelpContent {
  if (!loc) return en;
  const tours = { ...en.tours };
  for (const [id, tour] of Object.entries(loc.tours ?? {}) as [keyof HelpContent["tours"], HelpContent["tours"][keyof HelpContent["tours"]]][]) {
    if (tours[id] && tour?.steps?.length === tours[id].steps.length) tours[id] = tour;
  }
  return { guides: { ...en.guides, ...loc.guides }, tours };
}

export function helpContent(lang: Lang): HelpContent {
  if (lang === "de") return de;
  if (lang === "en") return en;
  return withFallback(localeExtra<Partial<HelpContent>>(lang, "content"));
}

export function useHelpContent(): HelpContent {
  const lang = useLang((s) => s.lang);
  useLang((s) => s.rev);
  return helpContent(lang);
}
