// OWNER: Content-Agent. Mod-Sets (instanzübergreifende Wunschlisten): Typen + Tauri-Wrapper.
// Bewusst eine eigene Datei statt lib/api.ts/types.ts, damit parallele Arbeit dort konfliktfrei bleibt.
// Backend: src-tauri/src/content/sets.rs, sets_apply.rs, commands/sets.rs.
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import type { ContentKind, LoaderKind, ProjectType, Source } from "@/lib/types";

export interface SetEntry {
  source: Source;
  project_id: string;
  slug: string | null;
  title: string;
  icon_url: string | null;
  project_type: ProjectType;
  added: number;
}

export interface ModSet {
  id: string;
  name: string;
  description: string | null;
  created: number;
  updated: number;
  entries: SetEntry[];
}

export interface ModSetInfo extends ModSet {
  /** Instanzen, auf die das Set angewendet wurde */
  used_by: string[];
}

export type LineStatus = "ok" | "guess" | "not_found" | "unsupported";

export interface ParsedLine {
  line: string;
  status: LineStatus;
  entry: SetEntry | null;
  /** "curseforge" (nicht eingerichtet), "link" (unbekannter Link) oder Fehlertext */
  message: string | null;
}

export interface ImportResult {
  name: string | null;
  description: string | null;
  lines: ParsedLine[];
}

export interface InstanceCandidate {
  entry: SetEntry;
  kind: ContentKind;
  file_name: string;
  enabled: boolean;
}

export interface InstanceCandidates {
  items: InstanceCandidate[];
  /** Dateien ohne bekannte Herkunft */
  unknown: string[];
}

export type ItemStatus = "install" | "installed" | "unavailable" | "conflict";
export type Reason = "needs_loader" | "other_loader" | "other_mc" | "no_files" | "not_found" | "needs_curseforge" | "modpack" | "failed";

export interface Alternative {
  kind: "older_mc" | "other_project";
  source: Source;
  project_id: string;
  title: string;
  icon_url: string | null;
  version_id: string;
  version_number: string;
  mc_version: string | null;
  recommended: boolean;
}

export interface DepInfo {
  key: string;
  title: string;
  icon_url: string | null;
  version_number: string;
}

export interface PreviewItem {
  key: string;
  entry: SetEntry;
  set_ids: string[];
  status: ItemStatus;
  version_id: string | null;
  version_number: string | null;
  file_name: string | null;
  kind: ContentKind | null;
  reason: Reason | null;
  message: string | null;
  loaders: string[];
  mc_range: [string, string] | null;
  alternatives: Alternative[];
  conflicts: string[];
  deps: DepInfo[];
  manual: boolean;
  installed_as: string | null;
  /** Nicht nötig: Ersatz mit demselben Zweck ist schon installiert */
  covered_by: string | null;
  selected: boolean;
}

export interface SetPreview {
  instance_id: string;
  mc_version: string;
  loader: LoaderKind;
  items: PreviewItem[];
}

export interface Pick {
  source: Source;
  project_id: string;
  version_id: string | null;
}

export interface SetCheck {
  total: number;
  available: number;
  missing: { title: string; icon_url: string | null; reason: Reason }[];
}

export interface CompatCell {
  mc: string;
  loader: LoaderKind;
  available: number;
}

export interface SetCompat {
  total: number;
  mc_versions: string[];
  loaders: LoaderKind[];
  cells: CompatCell[];
  entries: { key: string; loaders: LoaderKind[]; mc_min: string | null; mc_max: string | null; error: boolean }[];
  best: CompatCell | null;
}

export interface SetNews {
  set_id: string;
  name: string;
  new_entries: SetEntry[];
}

export const entryKey = (e: { source: Source; project_id: string }) => `${e.source}:${e.project_id}`;

export const setsApi = {
  list: () => invoke<ModSetInfo[]>("sets_list"),
  create: (name: string, entries: SetEntry[], description?: string | null) => invoke<ModSet>("sets_create", { name, description: description ?? null, entries }),
  update: (id: string, patch: { name?: string; description?: string }) =>
    invoke<ModSet>("sets_update", { id, name: patch.name ?? null, description: patch.description ?? null }),
  remove: (id: string) => invoke<void>("sets_delete", { id }),
  duplicate: (id: string) => invoke<ModSet>("sets_duplicate", { id }),
  addEntries: (id: string, entries: SetEntry[]) => invoke<ModSet>("sets_add_entries", { id, entries }),
  removeEntries: (id: string, keys: string[]) => invoke<ModSet>("sets_remove_entries", { id, keys }),
  parseList: (text: string) => invoke<ParsedLine[]>("sets_parse_list", { text }),
  importText: (text: string) => invoke<ImportResult>("sets_import_text", { text }),
  importFile: (path: string) => invoke<ImportResult>("sets_import_file", { path }),
  exportFile: (id: string, path: string) => invoke<void>("sets_export_file", { id, path }),
  exportCode: (id: string) => invoke<string>("sets_export_code", { id }),
  exportLinks: (id: string) => invoke<string>("sets_export_links", { id }),
  instanceCandidates: (instanceId: string) => invoke<InstanceCandidates>("sets_instance_candidates", { instanceId }),
  fromProfile: (instanceId: string, profileId: string) => invoke<[ModSet, number]>("sets_from_profile", { instanceId, profileId }),
  preview: (instanceId: string, setIds: string[], only?: string[] | null) => invoke<SetPreview>("sets_preview", { instanceId, setIds, only: only ?? null }),
  /** Task-ID (vorher Sicherung) */
  apply: (instanceId: string, setIds: string[], picks: Pick[]) => invoke<string>("sets_apply", { instanceId, setIds, picks }),
  /** Task-ID: neue Instanz, alles Passende ohne Vorschau */
  installNew: (instanceId: string, setIds: string[]) => invoke<string>("sets_install_new", { instanceId, setIds }),
  check: (setIds: string[], mcVersion: string, loader: LoaderKind) => invoke<SetCheck>("sets_check", { setIds, mcVersion, loader }),
  compat: (id: string) => invoke<SetCompat>("sets_compat", { id }),
  news: (instanceId: string) => invoke<SetNews[]>("sets_news", { instanceId }),
  dismissNews: (instanceId: string, setId: string, forget = false) => invoke<void>("sets_dismiss_news", { instanceId, setId, forget }),
};

export const setsKey = ["mod-sets"] as const;

export function useSets() {
  return useQuery({ queryKey: setsKey, queryFn: setsApi.list, staleTime: 30_000 });
}

export function useSetNews(instanceId: string, enabled = true) {
  return useQuery({ queryKey: ["mod-sets", "news", instanceId], queryFn: () => setsApi.news(instanceId), enabled, staleTime: 30_000 });
}

/** Nach Änderungen: Liste, Hinweise und Übersichten neu laden. */
export function invalidateSets() {
  return queryClient.invalidateQueries({ queryKey: setsKey });
}
