// Hilfen des Datei-Bereichs: Pfade, Symbole je Dateityp, Abfrage-Schlüssel, kurze Datumsangabe.
import {
  Database,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Package,
  ScrollText,
  Settings2,
} from "lucide-react";
import type { FileEntry, FileScope } from "@/lib/types";
import { intlLocale, useLang } from "@/i18n";

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const extOf = (p: string) => {
  const n = baseName(p);
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i + 1).toLowerCase() : i === 0 ? n.slice(1).toLowerCase() : "";
};

/** Alle Ordner oberhalb von `p` (nächster zuerst), ohne die Wurzel. */
export function ancestors(p: string): string[] {
  const out: string[] = [];
  let d = dirName(p);
  while (d) {
    out.push(d);
    d = dirName(d);
  }
  return out;
}

/** Liegt `p` in `dir` (oder ist es selbst)? */
export const isInside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);

export const scopeKey = (s: FileScope) => `${s.kind}:${s.id}`;
export const fkeys = {
  all: (s: FileScope) => ["files", scopeKey(s)] as const,
  dir: (s: FileScope, dir: string) => ["files", scopeKey(s), "dir", dir] as const,
  find: (s: FileScope, q: string) => ["files", scopeKey(s), "find", q] as const,
  search: (s: FileScope, q: string) => ["files", scopeKey(s), "search", q] as const,
};

/** Text, den der Launcher als „nur lesend“ öffnet (wie `files::is_log` in Rust). */
export function isLogPath(p: string) {
  const l = p.toLowerCase();
  return extOf(l) === "log" || l.startsWith("logs/") || l.startsWith("crash-reports/");
}

const WORLD_DIRS = new Set(["saves", "world", "world_nether", "world_the_end"]);

/** Symbol je Typ (Ordner nach bekannten Namen, Dateien nach Endung). */
export function FileIcon({ entry, open, size = 14 }: { entry: Pick<FileEntry, "name" | "is_dir" | "kind" | "path">; open?: boolean; size?: number }) {
  const cls = "shrink-0";
  if (entry.is_dir) {
    const n = entry.name.toLowerCase();
    if (entry.path === "config" || entry.path === "defaultconfigs") return <Settings2 size={size} className={`${cls} text-[#8fb4ff]`} />;
    if (WORLD_DIRS.has(entry.path)) return <Globe size={size} className={`${cls} text-ok`} />;
    if (n === "mods" || n === "plugins") return <Package size={size} className={`${cls} text-accent`} />;
    return open ? <FolderOpen size={size} className={`${cls} text-muted`} /> : <Folder size={size} className={`${cls} text-muted`} />;
  }
  const ext = extOf(entry.path);
  if (entry.kind === "image") return <FileImage size={size} className={`${cls} text-[#ff8fb1]`} />;
  if (ext === "json" || ext === "json5" || ext === "jsonc" || ext === "mcmeta" || ext === "snbt") return <FileBraces size={size} className={`${cls} text-[#ffb547]`} />;
  if (["toml", "yaml", "yml", "ini", "properties", "cfg", "conf", "js", "zs", "xml", "mcfunction", "sh", "bat", "cmd", "ps1"].includes(ext))
    return <FileCode size={size} className={`${cls} text-[#8fb4ff]`} />;
  if (ext === "log" || ext === "gz" || isLogPath(entry.path)) return <ScrollText size={size} className={`${cls} text-dim`} />;
  if (["jar", "zip", "mrpack", "7z", "rar", "tgz"].includes(ext)) return <FileArchive size={size} className={`${cls} text-muted`} />;
  if (["dat", "dat_old", "nbt", "mca", "mcr", "db", "sqlite"].includes(ext)) return <Database size={size} className={`${cls} text-dim`} />;
  if (entry.kind === "binary") return <File size={size} className={`${cls} text-dim`} />;
  return <FileText size={size} className={`${cls} text-muted`} />;
}

/** Kurzes Datum für Spalten: heute „14:05“, dieses Jahr „3. Nov.“, sonst „03.11.24“. */
export function useShortDate() {
  const lang = useLang((s) => s.lang);
  const loc = lang === "en" ? "en-GB" : intlLocale(lang);
  return (ms: number) => {
    if (!ms) return "–";
    const d = new Date(ms);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(loc, { day: "numeric", month: "short" });
    return d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
}

export const fullDate = (ms: number, lang: string) =>
  ms ? new Date(ms).toLocaleString(lang === "en" ? "en-GB" : intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "–";

export async function copyText(text: string) {
  try {
    const m = await import("@tauri-apps/plugin-clipboard-manager");
    await m.writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text);
  }
}
