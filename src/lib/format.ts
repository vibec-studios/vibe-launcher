import { convertFileSrc } from "@tauri-apps/api/core";
import { useLang } from "@/i18n";
import type { Loader, LoaderKind } from "./types";

const locale = () => (useLang.getState().lang === "en" ? "en-US" : "de-DE");

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(locale(), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

/** 1234567 -> "1,2 Mio." / "1.2M" */
export function formatCount(n: number): string {
  return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatDate(ms: number | string | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  const d = new Date(ms);
  return d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "vor 3 Std." / "3 hours ago" */
export function formatRelative(ms: number | string | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  const diff = (t - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto", style: "short" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

/** Spielzeit in "12 h 5 min" */
export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.floor(secs)} s`;
}

export const loaderNames: Record<LoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

/** Feste Farben je Loader (für Tags). */
export const loaderColors: Record<LoaderKind, string> = {
  vanilla: "#a1a1aa",
  fabric: "#dbb98f",
  quilt: "#c796f9",
  forge: "#8fa8ff",
  neoforge: "#ff9a52",
};

export function formatLoader(l: Loader): string {
  return l.kind === "vanilla" ? "Vanilla" : `${loaderNames[l.kind]}${l.version ? ` ${l.version}` : ""}`;
}

/** Lokalen Pfad oder URL als <img src> nutzbar machen. */
export function imageSrc(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl || /^(block|builtin):/.test(pathOrUrl)) return undefined;
  if (/^(https?:|data:|blob:|asset:)/.test(pathOrUrl) || pathOrUrl.startsWith("/")) return pathOrUrl;
  // Lokaler Windows-/Unix-Pfad -> asset-Protokoll
  try {
    return convertFileSrc(pathOrUrl);
  } catch {
    return undefined;
  }
}

/** Standard-Akzentfarben für Instanzen. */
export const accentPalette = ["#8b6cff", "#3fe0c5", "#ff6b9a", "#ffb547", "#5aa9ff", "#7ee07a", "#ff7a45", "#e05cff"];

/** Stabile Akzentfarbe aus der Instanz-ID ableiten, wenn keine gesetzt ist. */
export function instanceAccent(id: string, accent: string | null | undefined): string {
  if (accent) return accent;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return accentPalette[h % accentPalette.length];
}

/** Lesbare Textfarbe auf einer Akzentfläche. */
export function onAccent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const linear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000" : "#fff";
}
