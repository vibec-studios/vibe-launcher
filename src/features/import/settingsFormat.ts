// Anzeige der Einstellungen aus anderen Launchern: Kurzfassung für den Import-Dialog („Übernimmt: 6 GB RAM · Java 21 …“)
// und Werte „alt → neu“ für die Liste „Ansehen“ (Werte je Bereich wie in src-tauri/src/content/extsettings.rs `part`).
import { t, useLang } from "@/i18n";
import { formatDuration } from "@/lib/format";
import type { ExtExtraKey, ExtSettingKey, ExtSettings, PackSource } from "@/lib/types";

export const SETTING_KEYS: ExtSettingKey[] = ["memory", "java", "jvm_args", "env", "window", "hooks", "notes", "group"];
/** Start-Befehle laufen auf dem PC: nie vorausgewählt. */
export const DEFAULT_KEYS: ExtSettingKey[] = SETTING_KEYS.filter((k) => k !== "hooks");

/** 6144 -> "6 GB", 3584 -> "3,5 GB", 768 -> "768 MB" */
export function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1).replace(".", useLang.getState().lang === "en" ? "." : ",")} GB`;
}

/** "21.0.5" / "1.8.0_392" -> "21" / "8" */
export function javaMajor(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(?:1\.)?(\d+)/.exec(v.trim());
  return m ? m[1] : null;
}

export function hasKey(s: ExtSettings, k: ExtSettingKey): boolean {
  switch (k) {
    case "memory":
      return s.max_memory_mb != null || s.min_memory_mb != null;
    case "java":
      return !!s.java_path;
    case "jvm_args":
      return !!s.jvm_args;
    case "env":
      return Object.keys(s.env ?? {}).length > 0;
    case "window":
      return (s.width != null && s.height != null) || s.fullscreen != null;
    case "hooks":
      return !!(s.pre_launch || s.post_exit || s.wrapper);
    case "notes":
      return !!s.notes;
    case "group":
      return !!s.group;
  }
}

function memText(min: number | null | undefined, max: number | null | undefined): string | null {
  if (max != null && min != null && min !== max) return `${formatMb(min)}–${formatMb(max)}`;
  if (max != null) return formatMb(max);
  if (min != null) return `min. ${formatMb(min)}`;
  return null;
}

/** Ein Bereich als kurzer Text für „Übernimmt: …“. */
export function summaryPart(s: ExtSettings, k: ExtSettingKey): string | null {
  if (!hasKey(s, k)) return null;
  switch (k) {
    case "memory":
      return t("ext.set.ram", { v: memText(s.min_memory_mb, s.max_memory_mb) ?? "" });
    case "java": {
      const m = javaMajor(s.java_version);
      return m ? t("ext.set.java_v", { v: m }) : t("ext.set.java_own");
    }
    case "jvm_args":
      return t("ext.set.jvm");
    case "env": {
      const n = Object.keys(s.env).length;
      return n === 1 ? t("ext.set.env_1") : t("ext.set.env_n", { n });
    }
    case "window": {
      const parts: string[] = [];
      if (s.width != null && s.height != null) parts.push(t("ext.set.window_v", { w: s.width, h: s.height }));
      if (s.fullscreen) parts.push(t("ext.set.fullscreen"));
      return parts.join(", ") || null;
    }
    case "hooks":
      return t("ext.set.hooks_n");
    case "notes":
      return t("ext.set.notes");
    case "group":
      return t("ext.set.group_v", { v: s.group ?? "" });
  }
}

export function summary(s: ExtSettings | null | undefined, keys: readonly ExtSettingKey[]): string[] {
  if (!s) return [];
  return SETTING_KEYS.filter((k) => keys.includes(k))
    .map((k) => summaryPart(s, k))
    .filter((x): x is string => !!x);
}

/** Start-Befehle einer Instanz (zum Anzeigen, bevor sie übernommen werden). */
export function hookLines(h: { pre_launch?: string | null; post_exit?: string | null; wrapper?: string | null }): { label: string; cmd: string }[] {
  const out: { label: string; cmd: string }[] = [];
  if (h.pre_launch) out.push({ label: t("ext.set.hook.pre"), cmd: h.pre_launch });
  if (h.wrapper) out.push({ label: t("ext.set.hook.wrapper"), cmd: h.wrapper });
  if (h.post_exit) out.push({ label: t("ext.set.hook.post"), cmd: h.post_exit });
  return out;
}

const empty = (v: unknown) => v == null || v === "" || (typeof v === "object" && Object.values(v as object).every((x) => x == null || x === ""));
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Wert eines Bereichs (alt oder neu) als Text. */
export function formatValue(key: ExtSettingKey | ExtExtraKey, v: unknown): string {
  const o = (v ?? {}) as Record<string, unknown>;
  switch (key) {
    case "memory":
      return memText(o.min as number | null, o.max as number | null) ?? t("ext.set.default");
    case "java": {
      if (!o.path) return t("ext.set.auto");
      const m = javaMajor(o.version as string | null);
      return m ? `Java ${m} (${fileName(String(o.path))})` : String(o.path);
    }
    case "jvm_args":
    case "notes":
    case "group":
      return empty(v) ? t("ext.set.none") : short(String(v).replace(/\s*\n\s*/g, " · "));
    case "env": {
      const e = Object.entries(o);
      return e.length ? short(e.map(([k, x]) => `${k}=${x}`).join(", ")) : t("ext.set.none");
    }
    case "window": {
      const parts: string[] = [];
      if (o.width != null && o.height != null) parts.push(`${o.width}×${o.height}`);
      if (o.fullscreen === true) parts.push(t("ext.set.fullscreen"));
      else if (o.fullscreen === false) parts.push(t("ext.set.windowed"));
      return parts.join(", ") || t("ext.set.default");
    }
    case "hooks": {
      const l = hookLines(o as never);
      return l.length ? l.map((x) => `${x.label}: ${short(x.cmd, 40)}`).join(" · ") : t("ext.set.none");
    }
    case "playtime":
      return formatDuration(Number(o.secs ?? 0));
    case "icon":
      return v ? t("ext.set.key.icon") : t("ext.set.default");
    case "pack": {
      const p = v as PackSource | null;
      if (!p) return t("ext.set.none");
      return p.project_id ? t("ext.set.pack_v", { name: p.name ?? p.project_id }) : (p.name ?? t("ext.set.none"));
    }
  }
}
