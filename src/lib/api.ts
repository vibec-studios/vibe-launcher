// Typisierte Wrapper für alle Tauri-Commands. Argumentnamen: Tauri erwartet camelCase im JS
// für snake_case-Parameter in Rust (z. B. `instance_id` -> `instanceId`).
import { invoke } from "@tauri-apps/api/core";
import type * as T from "./types";

function call<R>(cmd: string, args?: Record<string, unknown>): Promise<R> {
  return invoke<R>(cmd, args);
}

/** Fehler aus dem Backend in lesbaren Text umwandeln. */
export function errorMessage(e: unknown): string {
  if (!e) return "Unbekannter Fehler";
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in (e as object)) return String((e as { message: unknown }).message);
  return String(e);
}

export function isCancelled(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as T.AppError).kind === "cancelled";
}

export const api = {
  // ---------------------------------------------------------------- Instanzen
  instancesList: () => call<T.Instance[]>("instances_list"),
  instanceGet: (id: string) => call<T.Instance>("instance_get", { id }),
  instanceCreate: (req: T.CreateInstance) => call<T.Instance>("instance_create", { req }),
  instanceUpdate: (id: string, patch: T.InstancePatch) => call<T.Instance>("instance_update", { id, patch }),
  instanceDelete: (id: string) => call<void>("instance_delete", { id }),
  instanceDuplicate: (id: string, name?: string | null) => call<T.Instance>("instance_duplicate", { id, name: name ?? null }),
  instanceSetIcon: (id: string, path: string | null) => call<T.Instance>("instance_set_icon", { id, path }),
  instanceOpenFolder: (id: string, sub?: string | null) => call<void>("instance_open_folder", { id, sub: sub ?? null }),

  // ---------------------------------------------------------------- Einstellungen / System / Aufgaben
  settingsGet: () => call<T.Settings>("settings_get"),
  settingsSet: (settings: T.Settings) => call<T.Settings>("settings_set", { settings }),
  systemInfo: () => call<T.SystemInfo>("system_info"),
  tasksList: () => call<T.TaskInfo[]>("tasks_list"),
  taskCancel: (id: string) => call<boolean>("task_cancel", { id }),
  tasksClear: () => call<void>("tasks_clear"),
  openPath: (path: string) => call<void>("open_path", { path }),
  openDataDir: () => call<void>("open_data_dir"),
  updateCheck: () => call<T.UpdateInfo | null>("update_check"),
  updateInstall: () => call<string>("update_install"),

  // ---------------------------------------------------------------- Accounts
  accountsList: () => call<T.Account[]>("accounts_list"),
  accountRemove: (id: string) => call<void>("account_remove", { id }),
  accountSetActive: (id: string) => call<void>("account_set_active", { id }),
  accountRefresh: (id: string) => call<T.Account>("account_refresh", { id }),
  authMsaAvailable: () => call<boolean>("auth_msa_available"),
  authMsaBegin: () => call<T.DeviceCode>("auth_msa_begin"),
  authMsaWait: () => call<T.Account>("auth_msa_wait"),
  authMsaCancel: () => call<void>("auth_msa_cancel"),

  // ---------------------------------------------------------------- Spiel
  gameVersions: (refresh = false) => call<T.McVersion[]>("game_versions", { refresh }),
  loaderGameVersions: (loader: T.LoaderKind) => call<string[]>("loader_game_versions", { loader }),
  loaderVersions: (loader: T.LoaderKind, mcVersion: string) => call<T.LoaderVersion[]>("loader_versions", { loader, mcVersion }),
  instanceInstall: (id: string, force = false) => call<string>("instance_install", { id, force }),
  instanceLaunch: (id: string, accountId?: string | null) => call<string>("instance_launch", { id, accountId: accountId ?? null }),
  instanceKill: (id: string) => call<void>("instance_kill", { id }),
  gameStates: () => call<T.GameState[]>("game_states"),
  instanceLogSession: (id: string) => call<T.LogLine[]>("instance_log_session", { id }),
  instanceLogFiles: (id: string) => call<T.LogFile[]>("instance_log_files", { id }),
  instanceLogRead: (id: string, name: string) => call<string>("instance_log_read", { id, name }),
  mclogsUpload: (content: string) => call<T.MclogsResult>("mclogs_upload", { content }),
  javaList: () => call<T.JavaInstall[]>("java_list"),
  javaTest: (path: string) => call<T.JavaInstall>("java_test", { path }),
  javaInstall: (major: number) => call<string>("java_install", { major }),

  // ---------------------------------------------------------------- Inhalte
  curseforgeAvailable: () => call<boolean>("curseforge_available"),
  contentSearch: (query: T.SearchQuery) => call<T.SearchResult>("content_search", { query }),
  contentCategories: (source: T.Source, projectType: T.ProjectType) => call<T.Category[]>("content_categories", { source, projectType }),
  contentProject: (source: T.Source, id: string) => call<T.ProjectDetails>("content_project", { source, id }),
  contentVersions: (source: T.Source, id: string, gameVersion?: string | null, loader?: T.LoaderKind | null) =>
    call<T.ProjectVersion[]>("content_versions", { source, id, gameVersion: gameVersion ?? null, loader: loader ?? null }),
  contentInstall: (instanceId: string, source: T.Source, projectId: string, versionId?: string | null) =>
    call<string>("content_install", { instanceId, source, projectId, versionId: versionId ?? null }),
  contentList: (instanceId: string, kind: T.ContentKind) => call<T.ContentItem[]>("content_list", { instanceId, kind }),
  contentSetEnabled: (instanceId: string, kind: T.ContentKind, fileName: string, enabled: boolean) =>
    call<T.ContentItem>("content_set_enabled", { instanceId, kind, fileName, enabled }),
  contentRemove: (instanceId: string, kind: T.ContentKind, fileNames: string[]) => call<void>("content_remove", { instanceId, kind, fileNames }),
  contentAddFiles: (instanceId: string, kind: T.ContentKind, paths: string[]) => call<T.ContentItem[]>("content_add_files", { instanceId, kind, paths }),
  contentCheckUpdates: (instanceId: string) => call<T.ContentUpdate[]>("content_check_updates", { instanceId }),
  contentUpdate: (instanceId: string, fileNames: string[]) => call<string>("content_update", { instanceId, fileNames }),
  worldsList: (instanceId: string) => call<T.World[]>("worlds_list", { instanceId }),
  worldDelete: (instanceId: string, folder: string) => call<void>("world_delete", { instanceId, folder }),
  modpackInstall: (source: T.Source, projectId: string, versionId?: string | null) =>
    call<string>("modpack_install", { source, projectId, versionId: versionId ?? null }),
  importPreview: (path: string) => call<T.ImportPreview>("import_preview", { path }),
  importPack: (path: string, name?: string | null) => call<string>("import_pack", { path, name: name ?? null }),
  exportEntries: (instanceId: string) => call<T.ExportEntry[]>("export_entries", { instanceId }),
  exportInstance: (instanceId: string, options: T.ExportOptions) => call<string>("export_instance", { instanceId, options }),
  contentMissing: (instanceId: string) => call<T.MissingDownload[]>("content_missing", { instanceId }),
  contentMissingDismiss: (instanceId: string) => call<void>("content_missing_dismiss", { instanceId }),
  launchersDetect: () => call<T.ExternalLauncher[]>("launchers_detect"),
  launcherScanDir: (path: string) => call<T.ExternalLauncher>("launcher_scan_dir", { path }),
  /** Gibt Task-ID zurück; mcVersion/loader überschreiben erkannte Werte. */
  importExternal: (source: T.LauncherKind, sourcePath: string, name?: string | null, mcVersion?: string | null, loader?: T.Loader | null) =>
    call<string>("import_external", { source, sourcePath, name: name ?? null, mcVersion: mcVersion ?? null, loader: loader ?? null }),
};
