import { create } from "zustand";
import { api } from "@/lib/api";
import type { CustomTheme } from "@/lib/types";
import type { ThemeExtension } from "@/lib/customThemes";
import { exportFile, extRevision, extensionOf, parseThemeInput } from "@/lib/customThemes";
import type { CompiledTheme } from "@/lib/themes/compile";

const CACHE = "vl.theme.ext";

interface Entry {
  rev: string;
  ext: ThemeExtension | null;
}

interface RuntimeState {
  exts: Record<string, Entry>;
  safe: boolean;
  paused: boolean;
  compiled: CompiledTheme | null;
}

function readCache(): Record<string, Entry> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE) ?? "null") as { id?: unknown; rev?: unknown; ext?: ThemeExtension } | null;
    if (raw && typeof raw.id === "string" && typeof raw.rev === "string" && raw.ext && typeof raw.ext.css === "string") return { [raw.id]: { rev: raw.rev, ext: raw.ext } };
  } catch {
    return {};
  }
  return {};
}

export const useThemeRuntime = create<RuntimeState>(() => ({ exts: readCache(), safe: false, paused: false, compiled: null }));

export function cacheExt(id: string | null, entry?: Entry) {
  try {
    if (!id || !entry?.ext) localStorage.removeItem(CACHE);
    else localStorage.setItem(CACHE, JSON.stringify({ id, rev: entry.rev, ext: entry.ext }));
  } catch {
    localStorage.removeItem(CACHE);
  }
}

const loading = new Map<string, Promise<ThemeExtension | null>>();

export function loadExt(id: string, rev: string): Promise<ThemeExtension | null> {
  const key = `${id}:${rev}`;
  const running = loading.get(key);
  if (running) return running;
  const p = api
    .appearanceThemeExtLoad(id)
    .then((content) => (content ? extensionOf(parseThemeInput(content, id).doc) : null))
    .catch(() => null)
    .then((ext) => {
      useThemeRuntime.setState((s) => ({ exts: { ...s.exts, [id]: { rev, ext } } }));
      loading.delete(key);
      return ext;
    });
  loading.set(key, p);
  return p;
}

export async function getExt(ct: CustomTheme): Promise<ThemeExtension | null> {
  if (!ct.ext) return null;
  const e = useThemeRuntime.getState().exts[ct.id];
  if (e && e.rev === ct.ext) return e.ext;
  return loadExt(ct.id, ct.ext);
}

export async function saveExt(ct: CustomTheme, ext: ThemeExtension): Promise<string> {
  const rev = extRevision(ext);
  await api.appearanceThemeExtSave(ct.id, exportFile({ ...ct, ext: rev }, ext));
  useThemeRuntime.setState((s) => ({ exts: { ...s.exts, [ct.id]: { rev, ext } } }));
  return rev;
}

export async function deleteExt(id: string) {
  await api.appearanceThemeExtDelete(id).catch(() => undefined);
  useThemeRuntime.setState((s) => {
    const exts = { ...s.exts };
    delete exts[id];
    return { exts };
  });
}

export function pruneExts(keep: string[]) {
  void api.appearanceThemeExtPrune(keep).catch(() => 0);
}

export function setSafe(safe: boolean) {
  useThemeRuntime.setState({ safe });
}
