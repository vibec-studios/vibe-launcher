import dict from "@/i18n/afk";
import { consoleLang } from "@/console/i18n";

const table: Record<string, string> = consoleLang === "de" ? { ...dict.de } : { ...dict.de, ...dict.en };

export function at(key: string, vars?: Record<string, string | number>) {
  let s = table[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
