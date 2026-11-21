export const LANGUAGES = [
  { code: "de", name: "Deutsch", english: "German", locale: "de-DE" },
  { code: "en", name: "English", english: "English", locale: "en-US" },
  { code: "es", name: "Español", english: "Spanish", locale: "es-ES" },
  { code: "fr", name: "Français", english: "French", locale: "fr-FR" },
  { code: "pl", name: "Polski", english: "Polish", locale: "pl-PL" },
  { code: "pt-BR", name: "Português (Brasil)", english: "Portuguese (Brazil)", locale: "pt-BR" },
  { code: "tr", name: "Türkçe", english: "Turkish", locale: "tr-TR" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

export const BASE_LANGS: readonly Lang[] = ["de", "en"];

const CODES = new Set<string>(LANGUAGES.map((l) => l.code));

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && CODES.has(v);
}

export function normalizeLang(v: string | null | undefined): Lang | null {
  if (!v) return null;
  if (isLang(v)) return v;
  const base = v.trim().toLowerCase().replace("_", "-").split("-")[0];
  if (base === "pt") return "pt-BR";
  return isLang(base) ? base : null;
}

export function intlLocale(lang: string): string {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? "en-US";
}

export function languageName(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.name ?? lang;
}
