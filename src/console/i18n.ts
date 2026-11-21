import dict from "@/i18n/sessions";
import { normalizeLang, type Lang } from "@/i18n/languages";

const localeFiles = import.meta.glob<Record<string, string>>("@/i18n/locales/*/sessions.json", { eager: true, import: "default" });

function lang(): Lang {
  try {
    return normalizeLang(localStorage.getItem("lang")) ?? "de";
  } catch {
    return "de";
  }
}

const current = lang();
const extra = Object.entries(localeFiles).find(([p]) => p.includes(`/locales/${current}/`))?.[1] ?? {};
const table: Record<string, string> =
  current === "de" || current === "en" ? { ...dict.de, ...dict[current] } : { ...dict.de, ...dict.en, ...extra };

export const consoleLang = current;

export function ct(key: string, vars?: Record<string, string | number>) {
  let s = table[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
