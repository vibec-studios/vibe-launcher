import { intlLocale, useLang } from "@/i18n";

export function dateTime(ms: number) {
  const loc = intlLocale(useLang.getState().lang);
  return new Date(ms).toLocaleString(loc, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
