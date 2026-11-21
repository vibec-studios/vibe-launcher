import { call } from "./call";
import type * as T from "../types";

export const contentApi = {
  // ---------------------------------------------------------------- Inhalte
  curseforgeAvailable: () => call<boolean>("curseforge_available"),
  contentSearch: (query: T.SearchQuery) => call<T.SearchResult>("content_search", { query }),
  contentCategories: (source: T.Source, projectType: T.ProjectType) => call<T.Category[]>("content_categories", { source, projectType }),
  contentProject: (source: T.Source, id: string) => call<T.ProjectDetails>("content_project", { source, id }),
  contentVersions: (source: T.Source, id: string, gameVersion?: string | null, loader?: T.LoaderKind | null) =>
    call<T.ProjectVersion[]>("content_versions", { source, id, gameVersion: gameVersion ?? null, loader: loader ?? null }),
  contentInstall: (instanceId: string, source: T.Source, projectId: string, versionId?: string | null, expectManual = false) =>
    call<string>("content_install", { instanceId, source, projectId, versionId: versionId ?? null, expectManual }),
  /** Ziel für „Auf CurseForge herunterladen“ (passende Version der Instanz) */
  contentManualTarget: (instanceId: string, source: T.Source, projectId: string, versionId?: string | null) =>
    call<T.ManualTarget>("content_manual_target", { instanceId, source, projectId, versionId: versionId ?? null }),
  /** CurseForge-Projekte der Instanz ohne Freigabe für andere Launcher */
  contentManualProjects: (instanceId: string) => call<string[]>("content_manual_projects", { instanceId }),
  contentMissingScan: (instanceId: string) => call<T.MissingScan>("content_missing_scan", { instanceId }),
  contentMissingWatch: (instanceId: string) => call<number | null>("content_missing_watch", { instanceId }),
  contentList: (instanceId: string, kind: T.ContentKind) => call<T.ContentItem[]>("content_list", { instanceId, kind }),
  contentSetEnabled: (instanceId: string, kind: T.ContentKind, fileName: string, enabled: boolean) =>
    call<T.ContentItem>("content_set_enabled", { instanceId, kind, fileName, enabled }),
  contentRemove: (instanceId: string, kind: T.ContentKind, fileNames: string[]) => call<void>("content_remove", { instanceId, kind, fileNames }),
  contentAddFiles: (instanceId: string, kind: T.ContentKind, paths: string[]) => call<T.ContentItem[]>("content_add_files", { instanceId, kind, paths }),
  contentCheckUpdates: (instanceId: string) => call<T.ContentUpdate[]>("content_check_updates", { instanceId }),
  contentUpdate: (instanceId: string, fileNames: string[]) => call<string>("content_update", { instanceId, fileNames }),
  worldsList: (instanceId: string) => call<T.World[]>("worlds_list", { instanceId }),
  datapacksOverview: (instanceId: string) => call<T.DatapackOverview>("datapacks_overview", { instanceId }),
  datapacksCopyToWorlds: (instanceId: string, files: string[], worlds: string[]) => call<number>("datapacks_copy_to_worlds", { instanceId, files, worlds }),
  worldDelete: (instanceId: string, folder: string) => call<void>("world_delete", { instanceId, folder }),
  modpackInstall: (source: T.Source, projectId: string, versionId?: string | null) =>
    call<string>("modpack_install", { source, projectId, versionId: versionId ?? null }),
  importPreview: (path: string) => call<T.ImportPreview>("import_preview", { path }),
  importPack: (path: string, name?: string | null) => call<string>("import_pack", { path, name: name ?? null }),
  exportEntries: (instanceId: string) => call<T.ExportEntry[]>("export_entries", { instanceId }),
  exportInstance: (instanceId: string, options: T.ExportOptions) => call<string>("export_instance", { instanceId, options }),
  contentMissing: (instanceId: string) => call<T.MissingDownload[]>("content_missing", { instanceId }),
  contentMissingDismiss: (instanceId: string) => call<void>("content_missing_dismiss", { instanceId }),
  contentSetPinned: (instanceId: string, kind: T.ContentKind, fileName: string, pinned: boolean) =>
    call<T.ContentItem>("content_set_pinned", { instanceId, kind, fileName, pinned }),
  /** Updates je Instanz (Hintergrundprüfung, höchstens alle 30 min; danach content://changed) */
  contentUpdateCounts: () => call<Record<string, number>>("content_update_counts"),
  storesList: () => call<T.StoreInfo[]>("stores_list"),
  storeAdd: (url: string) => call<T.StoreInfo>("store_add", { url }),
  storeRemove: (id: string) => call<void>("store_remove", { id }),
  storeSetEnabled: (id: string, enabled: boolean) => call<void>("store_set_enabled", { id, enabled }),
  modpackCheck: (instanceId: string) => call<T.ModpackUpdate | null>("modpack_check", { instanceId }),
  modpackUpdatePreview: (instanceId: string, versionId?: string | null) =>
    call<T.ModpackPreview>("modpack_update_preview", { instanceId, versionId: versionId ?? null }),
  /** Gibt Task-ID zurück (vorher automatischer Snapshot). */
  modpackUpdate: (instanceId: string, versionId?: string | null) => call<string>("modpack_update", { instanceId, versionId: versionId ?? null }),
  contentCheckDeps: (instanceId: string) => call<T.DepIssue[]>("content_check_deps", { instanceId }),
  /** ignoreCrash: nur statisch prüfen (Nachprüfung nach dem Beheben) */
  autofixPlan: (instanceId: string, crashReport?: string | null, exitCode?: number | null, ignoreCrash?: boolean) =>
    call<T.FixPlan>("autofix_plan", { instanceId, crashReport: crashReport ?? null, exitCode: exitCode ?? null, ignoreCrash: ignoreCrash ?? false }),
  /** Task-ID; Ergebnis danach über autofixLast */
  autofixApply: (instanceId: string, actions: T.FixAction[], backup?: T.FixBackup | null) => call<string>("autofix_apply", { instanceId, actions, backup: backup ?? null }),
  autofixLast: (instanceId: string) => call<T.FixReport | null>("autofix_last", { instanceId }),
  autofixUndo: (instanceId: string) => call<string>("autofix_undo", { instanceId }),
  autofixQuick: (instanceId: string) => call<T.QuickCheck>("autofix_quick", { instanceId }),
  /** „Neu prüfen“: Ordner neu einlesen, Updates ohne Cache, Probleme (inkl. Loader) neu berechnen */
  instanceRefresh: (instanceId: string) => call<T.RefreshReport>("instance_refresh", { instanceId }),
  contentSides: (instanceId: string) => call<T.SideInfo[]>("content_sides", { instanceId }),
  modsetsList: (instanceId: string) => call<T.ModSets>("modsets_list", { instanceId }),
  modsetCreate: (instanceId: string, name: string) => call<T.ModSets>("modset_create", { instanceId, name }),
  modsetApply: (instanceId: string, setId: string) => call<T.ModSets>("modset_apply", { instanceId, setId }),
  modsetSave: (instanceId: string, setId: string) => call<T.ModSets>("modset_save", { instanceId, setId }),
  modsetRename: (instanceId: string, setId: string, name: string) => call<T.ModSets>("modset_rename", { instanceId, setId, name }),
  modsetDelete: (instanceId: string, setId: string) => call<T.ModSets>("modset_delete", { instanceId, setId }),
  perfPreview: (instanceId: string) => call<T.PerfCandidate[]>("perf_preview", { instanceId }),
  quickModStatus: (instanceId: string, tool: T.QuickMod) => call<T.QuickModStatus>("quick_mod_status", { instanceId, tool }),
  quickModInstall: (instanceId: string, tool: T.QuickMod) => call<string>("quick_mod_install", { instanceId, tool }),
  /** Gibt Task-ID zurück (vorher Snapshot). */
  perfInstall: (instanceId: string, projectIds: string[]) => call<string>("perf_install", { instanceId, projectIds }),
  launchersDetect: () => call<T.ExternalLauncher[]>("launchers_detect"),
  launcherScanDir: (path: string) => call<T.ExternalLauncher>("launcher_scan_dir", { path }),
  /** Gibt Task-ID zurück; mcVersion/loader überschreiben erkannte Werte. */
  /** `settings`: übernommene Bereiche (null = Standard: alle außer Start-Befehlen). */
  importExternal: (
    source: T.LauncherKind,
    sourcePath: string,
    name?: string | null,
    mcVersion?: string | null,
    loader?: T.Loader | null,
    settings?: T.ExtSettingKey[] | null,
  ) =>
    call<string>("import_external", { source, sourcePath, name: name ?? null, mcVersion: mcVersion ?? null, loader: loader ?? null, settings: settings ?? null }),
  importSettingsPending: () => call<T.SettingsOffer[]>("import_settings_pending"),
  importSettingsOffer: (instanceId: string) => call<T.SettingsOffer | null>("import_settings_offer", { instanceId }),
  /** `files`: "options" | "config" erneut kopieren (vorher Snapshot). */
  importSettingsApply: (instanceId: string, keys: string[], data: T.DataPick[]) => call<T.Instance>("import_settings_apply", { instanceId, keys, data }),
  importReport: (instanceId: string) => call<T.ImportReport | null>("import_report", { instanceId }),
};
