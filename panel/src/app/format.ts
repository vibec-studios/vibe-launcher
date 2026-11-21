import { getLang } from "@/i18n";

const loc = () => (getLang() === "de" ? "de-DE" : "en-US");

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toLocaleString(loc(), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

export function mib(n: number): string {
  return n >= 1024 ? `${(n / 1024).toLocaleString(loc(), { maximumFractionDigits: 1 })} GB` : `${n} MB`;
}

export function number(n: number): string {
  return new Intl.NumberFormat(loc(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(loc(), { dateStyle: "medium", timeStyle: "short" });
}

export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: "auto" });
  if (s < 60) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86_400), "day");
}

export function duration(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
