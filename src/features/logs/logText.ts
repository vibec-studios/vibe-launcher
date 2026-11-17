// Log-Text: Dateien parsen, Zeilen formatieren, Level-Kategorien, mclo.gs-Upload, Zwischenablage.
import { api } from "@/lib/api";
import type { LogLevel, LogLine } from "@/lib/types";
import { toast } from "@/components/ui";
import { t } from "@/i18n";

export type LevelCat = "debug" | "info" | "warn" | "error" | "launcher";
export const CATS: LevelCat[] = ["info", "warn", "error", "debug", "launcher"];

export function catOf(l: LogLevel): LevelCat {
  switch (l) {
    case "trace":
    case "debug":
      return "debug";
    case "warn":
      return "warn";
    case "error":
    case "fatal":
    case "stderr":
      return "error";
    case "launcher":
      return "launcher";
    default:
      return "info";
  }
}

const LEVELS: Record<string, LogLevel> = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  WARNING: "warn",
  ERROR: "error",
  FATAL: "fatal",
  SEVERE: "error",
};

// [12:34:56] [Render thread/INFO]: …        (Vanilla)
// [12:34:56] [main/INFO] (FabricLoader) …   (Fabric)
// [17Jun2024 12:34:56.789] [main/INFO] [cpw.mods.modlauncher.Launcher/]: …   (Forge/NeoForge)
const RE = /^\[(?:[^\]]*?\s)?(\d{1,2}:\d{2}:\d{2})(?:[.,]\d+)?\]\s+\[([^\]]*?)\/([A-Za-z]+)\](?:\s+[[(]([^\])]*)[\])])?:?\s?(.*)$/;

/** Rohtext einer Log-Datei in Zeilen zerlegen. Folgezeilen (Stacktraces) erben das Level. */
export function parseLog(text: string, crash = false): LogLine[] {
  const raw = text.split(/\r?\n/);
  if (raw.length && raw[raw.length - 1] === "") raw.pop();
  const out: LogLine[] = new Array(raw.length);
  let prev: LogLevel = crash ? "stdout" : "stdout";
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const m = RE.exec(line);
    if (m) {
      const level = LEVELS[m[3].toUpperCase()] ?? "stdout";
      prev = level;
      out[i] = { seq: i, time: m[1], level, thread: m[2] || null, logger: m[4]?.replace(/\/$/, "") || null, text: m[5] };
    } else {
      let level = prev;
      if (crash && /^(Description:|java\.|Caused by:|\s+at |-- |---- )/.test(line)) level = /^(Description:|Caused by:|java\.)/.test(line) ? "error" : "stdout";
      out[i] = { seq: i, time: null, level, thread: null, logger: null, text: line };
    }
  }
  return out;
}

const LEVEL_TAG: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  fatal: "FATAL",
  stdout: "OUT",
  stderr: "ERR",
  launcher: "LAUNCH",
};

/** Eine Zeile im üblichen Log4j-Format (für Kopieren/Upload). */
export function formatLine(l: LogLine): string {
  if (!l.time) return l.text;
  return `[${l.time}] [${l.thread ?? "main"}/${LEVEL_TAG[l.level]}]${l.logger ? ` [${l.logger}]` : ""}: ${l.text}`;
}

export function formatLines(lines: LogLine[]): string {
  let s = "";
  for (let i = 0; i < lines.length; i++) s += (i ? "\n" : "") + formatLine(lines[i]);
  return s;
}

export const levelTag = (l: LogLevel) => LEVEL_TAG[l];

export async function writeClipboard(text: string) {
  try {
    const m = await import("@tauri-apps/plugin-clipboard-manager");
    await m.writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => {});
  }
}

export async function copyText(text: string) {
  await writeClipboard(text);
  toast.success(t("common.copied"));
}

/** Text zu mclo.gs hochladen, Link kopieren, Toast mit „Öffnen“. mclo.gs nimmt max. 25 000 Zeilen. */
export async function uploadToMclogs(content: string): Promise<string | null> {
  if (!content.trim()) {
    toast.error(t("logs.upload_empty"));
    return null;
  }
  const lines = content.split("\n");
  const body = lines.length > 25_000 ? lines.slice(-25_000).join("\n") : content;
  try {
    const r = await api.mclogsUpload(body);
    await writeClipboard(r.url);
    toast.success(t("logs.uploaded"), r.url, {
      label: t("logs.open_link"),
      onClick: () => {
        import("@tauri-apps/plugin-opener").then((m) => m.openUrl(r.url)).catch(() => window.open(r.url, "_blank"));
      },
    });
    return r.url;
  } catch (e) {
    toast.error(e, t("logs.upload_failed"));
    return null;
  }
}

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/** Log-Datei-Name (relativ zum Spielordner) zu einem Pfad finden, z. B. dem Crash-Report aus `game://state`. */
export function matchLogFile(names: string[], path: string): string | null {
  const p = norm(path);
  return names.find((n) => norm(n) === p || p.endsWith("/" + norm(n))) ?? null;
}
