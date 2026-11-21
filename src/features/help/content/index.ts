import { useLang, type Lang } from "@/i18n";
import type { HelpContent } from "../types";
import de from "./de";
import en from "./en";

const CONTENT: Record<Lang, HelpContent> = { de, en };

export function helpContent(lang: Lang): HelpContent {
  return CONTENT[lang] ?? de;
}

export function useHelpContent(): HelpContent {
  return helpContent(useLang((s) => s.lang));
}
