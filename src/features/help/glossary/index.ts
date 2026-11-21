import { localeExtra, useLang } from "@/i18n";
import type { Glossary, TermText } from "./terms";
import de from "./de";
import en from "./en";

export function useGlossary(): Glossary {
  const lang = useLang((s) => s.lang);
  useLang((s) => s.rev);
  if (lang === "de") return de;
  if (lang === "en") return en;
  const loc = localeExtra<Partial<Glossary>>(lang, "glossary");
  return loc ? { ...en, ...loc } : en;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function matchTerm(term: TermText, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm([term.title, term.text, term.example ?? ""].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export { TERMS, type TermId } from "./terms";
