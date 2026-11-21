import { useLang, type Lang } from "@/i18n";
import type { Glossary, TermText } from "./terms";
import de from "./de";
import en from "./en";

const GLOSSARY: Record<Lang, Glossary> = { de, en };

export function useGlossary(): Glossary {
  return GLOSSARY[useLang((s) => s.lang)] ?? de;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function matchTerm(term: TermText, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm([term.title, term.text, term.example ?? ""].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export { TERMS, type TermId } from "./terms";
