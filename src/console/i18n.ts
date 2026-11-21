import dict from "@/i18n/sessions";

type Lang = "de" | "en";

function lang(): Lang {
  try {
    return localStorage.getItem("lang") === "en" ? "en" : "de";
  } catch {
    return "de";
  }
}

const current = lang();
const table: Record<string, string> = { ...dict.de, ...dict[current] };

export const consoleLang = current;

export function ct(key: string, vars?: Record<string, string | number>) {
  let s = table[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
