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
  /** Hintergrund-Datei in den Datenordner kopieren; gibt den neuen Pfad zurück. */
  appearanceImportBackground: (path: string, slot: "image" | "video") => call<string>("appearance_import_background", { path, slot }),
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

  // ---------------------------------------------------------------- Skins & Capes (accountId null = aktiver Account)
  skinsProfile: (accountId?: string | null) => call<T.SkinProfile>("skins_profile", { accountId: accountId ?? null }),
  skinUploadFile: (accountId: string | null, path: string, variant: T.SkinVariant) =>
    call<T.SkinProfile>("skin_upload_file", { accountId, path, variant }),
  skinApplyLibrary: (accountId: string | null, id: string, variant?: T.SkinVariant | null) =>
    call<T.SkinProfile>("skin_apply_library", { accountId, id, variant: variant ?? null }),
  skinSetVariant: (accountId: string | null, variant: T.SkinVariant) => call<T.SkinProfile>("skin_set_variant", { accountId, variant }),
  skinReset: (accountId: string | null) => call<T.SkinProfile>("skin_reset", { accountId }),
  /** capeId null = Cape ausblenden */
  capeSet: (accountId: string | null, capeId: string | null) => call<T.SkinProfile>("cape_set", { accountId, capeId }),
  skinLibraryList: () => call<T.LibrarySkin[]>("skin_library_list"),
  skinLibraryAddFile: (path: string, name?: string | null, variant?: T.SkinVariant | null) =>
    call<T.LibrarySkin>("skin_library_add_file", { path, name: name ?? null, variant: variant ?? null }),
  skinLibraryAddCurrent: (accountId: string | null) => call<T.LibrarySkin>("skin_library_add_current", { accountId }),
  skinLibraryImportPlayer: (name: string) => call<T.LibrarySkin>("skin_library_import_player", { name }),
  skinLibraryRename: (id: string, name: string) => call<T.LibrarySkin>("skin_library_rename", { id, name }),
  skinLibrarySetVariant: (id: string, variant: T.SkinVariant) => call<T.LibrarySkin>("skin_library_set_variant", { id, variant }),
  skinLibraryRemove: (id: string) => call<void>("skin_library_remove", { id }),
  skinLibraryExport: (id: string, path: string) => call<void>("skin_library_export", { id, path }),
  skinLibraryReveal: (id: string) => call<void>("skin_library_reveal", { id }),

  // ---------------------------------------------------------------- Spiel
  gameVersions: (refresh = false) => call<T.McVersion[]>("game_versions", { refresh }),
  loaderGameVersions: (loader: T.LoaderKind) => call<string[]>("loader_game_versions", { loader }),
  loaderVersions: (loader: T.LoaderKind, mcVersion: string) => call<T.LoaderVersion[]>("loader_versions", { loader, mcVersion }),
  instanceInstall: (id: string, force = false) => call<string>("instance_install", { id, force }),
  /** `world`: Ordnername unter saves/ – startet per Quick Play direkt in diese Welt (ab Minecraft 1.20). */
  /** `server`: Adresse (host[:port]) – direkt auf diesen Server (Quick Play ab 1.20, sonst --server/--port). */
  instanceLaunch: (id: string, accountId?: string | null, world?: string | null, server?: string | null) =>
    call<string>("instance_launch", { id, accountId: accountId ?? null, world: world ?? null, server: server ?? null }),
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
  contentSides: (instanceId: string) => call<T.SideInfo[]>("content_sides", { instanceId }),
  modsetsList: (instanceId: string) => call<T.ModSets>("modsets_list", { instanceId }),
  modsetCreate: (instanceId: string, name: string) => call<T.ModSets>("modset_create", { instanceId, name }),
  modsetApply: (instanceId: string, setId: string) => call<T.ModSets>("modset_apply", { instanceId, setId }),
  modsetSave: (instanceId: string, setId: string) => call<T.ModSets>("modset_save", { instanceId, setId }),
  modsetRename: (instanceId: string, setId: string, name: string) => call<T.ModSets>("modset_rename", { instanceId, setId, name }),
  modsetDelete: (instanceId: string, setId: string) => call<T.ModSets>("modset_delete", { instanceId, setId }),
  perfPreview: (instanceId: string) => call<T.PerfCandidate[]>("perf_preview", { instanceId }),
  /** Gibt Task-ID zurück (vorher Snapshot). */
  perfInstall: (instanceId: string, projectIds: string[]) => call<string>("perf_install", { instanceId, projectIds }),
  launchersDetect: () => call<T.ExternalLauncher[]>("launchers_detect"),
  launcherScanDir: (path: string) => call<T.ExternalLauncher>("launcher_scan_dir", { path }),
  /** Gibt Task-ID zurück; mcVersion/loader überschreiben erkannte Werte. */
  importExternal: (source: T.LauncherKind, sourcePath: string, name?: string | null, mcVersion?: string | null, loader?: T.Loader | null) =>
    call<string>("import_external", { source, sourcePath, name: name ?? null, mcVersion: mcVersion ?? null, loader: loader ?? null }),

  // ---------------------------------------------------------------- Lokale Server (OWNER Game-Agent)
  serversList: () => call<T.Server[]>("servers_list"),
  serverGet: (id: string) => call<T.Server>("server_get", { id }),
  /** Legt den Server an und startet die Installation (Task-ID im Ergebnis). */
  serverCreate: (req: T.ServerCreate) => call<T.ServerCreated>("server_create", { req }),
  /** Mods einer Instanz mit Client/Server-Einordnung (für „Aus Instanz erstellen“) */
  serverModCandidates: (instanceId: string) => call<T.ServerModCandidate[]>("server_mod_candidates", { instanceId }),
  serverUpdate: (id: string, patch: T.ServerPatch) => call<T.Server>("server_update", { id, patch }),
  serverDelete: (id: string) => call<void>("server_delete", { id }),
  /** PNG wird auf 64×64 gebracht und als server-icon.png gespeichert; null = entfernen */
  serverSetIcon: (id: string, path: string | null) => call<T.Server>("server_set_icon", { id, path }),
  serverInstall: (id: string, force = false) => call<string>("server_install", { id, force }),
  serverAcceptEula: (id: string) => call<T.Server>("server_accept_eula", { id }),
  /** Fehler `invalid`, wenn EULA fehlt oder der Port belegt ist */
  serverStart: (id: string) => call<void>("server_start", { id }),
  /** Sauber per `stop`, nach Zeitlimit hart beenden */
  serverStop: (id: string) => call<void>("server_stop", { id }),
  serverRestart: (id: string) => call<void>("server_restart", { id }),
  serverKill: (id: string) => call<void>("server_kill", { id }),
  serverCommand: (id: string, command: string) => call<void>("server_command", { id, command }),
  serverStatuses: () => call<T.ServerStatus[]>("server_statuses"),
  serverLog: (id: string) => call<T.LogLine[]>("server_log", { id }),
  serverAddresses: (id: string) => call<T.ServerAddresses>("server_addresses", { id }),
  /** Einträge in Datei-Reihenfolge [Schlüssel, Wert] */
  serverPropertiesGet: (id: string) => call<[string, string][]>("server_properties_get", { id }),
  /** Übernimmt nur die übergebenen Schlüssel (Rest bleibt). Wirkt beim nächsten Start. */
  serverPropertiesSet: (id: string, values: Record<string, string>) => call<[string, string][]>("server_properties_set", { id, values }),
  serverPropertiesRaw: (id: string) => call<string>("server_properties_raw", { id }),
  serverPropertiesRawSet: (id: string, text: string) => call<void>("server_properties_raw_set", { id, text }),
  serverPlayers: (id: string) => call<T.ServerPlayers>("server_players", { id }),
  /** Name -> UUID über Mojang (offline-mode: Offline-UUID). Bei laufendem Server per Konsolenbefehl. */
  serverPlayerAction: (id: string, list: T.ServerPlayerList, action: "add" | "remove", name: string, reason?: string | null) =>
    call<T.ServerPlayers>("server_player_action", { id, list, action, name, reason: reason ?? null }),
  serverSetWhitelist: (id: string, enabled: boolean) => call<T.ServerPlayers>("server_set_whitelist", { id, enabled }),
  serverWorlds: (id: string) => call<T.ServerWorld[]>("server_worlds", { id }),
  serverBackups: (id: string) => call<T.ServerBackup[]>("server_backups", { id }),
  /** world null = aktive Welt. Läuft der Server, wird vorher gespeichert (save-off/save-all). Task-ID */
  serverBackupCreate: (id: string, world?: string | null) => call<string>("server_backup_create", { id, world: world ?? null }),
  serverBackupDelete: (id: string, name: string) => call<void>("server_backup_delete", { id, name }),
  /** Nur bei gestopptem Server. Task-ID */
  serverBackupRestore: (id: string, name: string) => call<string>("server_backup_restore", { id, name }),
  serverOpenFolder: (id: string, sub?: string | null) => call<void>("server_open_folder", { id, sub: sub ?? null }),
  /** Relay: neue Adresse; playit: Agent-Verknüpfung löschen (neuer Claim-Link) */
  serverTunnelReset: (id: string) => call<void>("server_tunnel_reset", { id }),
  /** Antwort auf `servers://close-requested`: stop = Server vorher sauber beenden; danach schließt der Launcher */
  serversQuit: (stop: boolean) => call<void>("servers_quit", { stop }),

  // ---------------------------------------------------------------- Screenshots
  screenshotsList: (instanceId?: string | null) => call<T.Screenshot[]>("screenshots_list", { instanceId: instanceId ?? null }),
  /** Pfad eines gecachten Vorschaubilds (JPEG, max. 480×360) */
  screenshotThumb: (path: string) => call<string>("screenshot_thumb", { path }),
  screenshotDelete: (path: string) => call<void>("screenshot_delete", { path }),
  screenshotCopy: (path: string) => call<void>("screenshot_copy", { path }),
  screenshotOpenFolder: (path: string) => call<void>("screenshot_open_folder", { path }),

  // ---------------------------------------------------------------- Plattform (Crash-Analyse, Server, Statistik …)
  crashAnalyze: (instanceId: string, crashReport?: string | null, exitCode?: number | null) =>
    call<T.Diagnosis[]>("crash_analyze", { instanceId, crashReport: crashReport ?? null, exitCode: exitCode ?? null }),
  instanceServersList: (instanceId: string) => call<T.ServerEntry[]>("instance_servers_list", { instanceId }),
  instanceServersSave: (instanceId: string, servers: T.ServerEntry[]) => call<void>("instance_servers_save", { instanceId, servers }),
  serverPing: (address: string) => call<T.ServerPing>("server_ping", { address }),
  serversRecent: (limit?: number) => call<T.RecentServer[]>("servers_recent", { limit: limit ?? null }),
  playtimeSessions: (since?: number | null) => call<T.PlaySession[]>("playtime_sessions", { since: since ?? null }),
  optsyncGet: () => call<T.OptSyncInfo>("optsync_get"),
  optsyncSetInstance: (instanceId: string, enabled: boolean, categories: T.OptSyncCategory[]) =>
    call<T.OptSyncInfo>("optsync_set_instance", { instanceId, enabled, categories }),
  optsyncCapture: (instanceId: string, categories: T.OptSyncCategory[]) => call<T.OptSyncInfo>("optsync_capture", { instanceId, categories }),
  optsyncApplyAll: () => call<number>("optsync_apply_all"),
  shortcutCreate: (instanceId: string, location: "desktop" | "start_menu") => call<string>("shortcut_create", { instanceId, location }),
  appActionsTake: () => call<T.AppAction[]>("app_actions_take"),
  discordAvailable: () => call<boolean>("discord_available"),
  // ---------------------------------------------------------------- Vibe-Dienste (Netzwerk nur, wenn settings.vibe.enabled)
  vibeStatus: () => call<T.VibeStatus>("vibe_status"),
  vibeTokensGet: () => call<T.VibeTokens | null>("vibe_tokens_get"),
  vibeTokensSet: (tokens: T.VibeTokens | null) => call<void>("vibe_tokens_set", { tokens }),
  /** Mojang-Join mit dem Token des aktiven Accounts (bleibt in Rust) – liefert den Minecraft-Namen */
  vibeMojangJoin: (serverId: string) => call<{ name: string; uuid: string }>("vibe_mojang_join", { serverId }),
  vibeHttp: (request: T.VibeHttpRequest) => call<T.VibeHttpResponse>("vibe_http", { request }),
  vibeWsOpen: (id: string, url: string) => call<void>("vibe_ws_open", { id, url }),
  vibeWsSend: (id: string, data: string) => call<void>("vibe_ws_send", { id, data }),
  vibeWsClose: (id: string, code?: number, reason?: string) => call<void>("vibe_ws_close", { id, code: code ?? null, reason: reason ?? null }),
  /** Exportiert + lädt hoch, liefert das Pack (JSON des Backends) */
  vibePackShare: (instanceId: string, token: string, options: T.VibeShareOptions) => call<unknown>("vibe_pack_share", { instanceId, token, options }),
  vibePackLink: (instanceId: string) => call<T.VibeShareLink | null>("vibe_pack_link", { instanceId }),
  /** Gibt Task-ID zurück */
  vibePackInstall: (code: string, versionId?: string | null, token?: string | null) =>
    call<string>("vibe_pack_install", { code, versionId: versionId ?? null, token: token ?? null }),
  // ---------------------------------------------------------------- Backups (Snapshots + Welt-Backups)
  snapshotsList: (instanceId: string) => call<T.SnapshotInfo[]>("snapshots_list", { instanceId }),
  /** Gibt Task-ID zurück */
  snapshotCreate: (instanceId: string, name?: string | null) => call<string>("snapshot_create", { instanceId, name: name ?? null }),
  /** Gibt Task-ID zurück; legt vorher automatisch „Vor Wiederherstellung“ an */
  snapshotRestore: (instanceId: string, snapshotId: string) => call<string>("snapshot_restore", { instanceId, snapshotId }),
  snapshotDelete: (instanceId: string, snapshotId: string) => call<void>("snapshot_delete", { instanceId, snapshotId }),
  worldBackupsList: (instanceId: string) => call<T.WorldBackup[]>("world_backups_list", { instanceId }),
  /** Gibt Task-ID zurück */
  worldBackupCreate: (instanceId: string, folder: string) => call<string>("world_backup_create", { instanceId, folder }),
  /** Gibt Task-ID zurück; vorhandene Welt wird vorher gesichert */
  worldBackupRestore: (instanceId: string, backupId: string) => call<string>("world_backup_restore", { instanceId, backupId }),
  worldBackupDelete: (instanceId: string, backupId: string) => call<void>("world_backup_delete", { instanceId, backupId }),
  /** Gibt Task-ID zurück (Task gehört zur Ziel-Instanz) */
  worldCopy: (instanceId: string, folder: string, targetInstanceId: string) => call<string>("world_copy", { instanceId, folder, targetInstanceId }),
  /** Gibt Task-ID zurück */
  worldImportZip: (instanceId: string, path: string) => call<string>("world_import_zip", { instanceId, path }),
  backupsOpenFolder: (instanceId: string, kind: "worlds" | "snapshots") => call<void>("backups_open_folder", { instanceId, kind }),
  // ---------------------------------------------------------------- Dateien (Instanz-/Serverordner, commands/files.rs)
  /** Direkte Einträge eines Ordners ("" = Hauptordner) */
  filesList: (scope: T.FileScope, dir: string) => call<T.FileEntry[]>("files_list", { scope, dir }),
  filesStat: (scope: T.FileScope, path: string) => call<T.FileEntry>("files_stat", { scope, path }),
  /** Namenssuche im ganzen Ordner (max. 500 Treffer) */
  filesFind: (scope: T.FileScope, query: string) => call<T.FileFindResult>("files_find", { scope, query }),
  /** Volltextsuche in Textdateien bis 1 MB (max. 200 Treffer) */
  filesSearch: (scope: T.FileScope, query: string, dir?: string | null) => call<T.FileSearchResult>("files_search", { scope, query, dir: dir ?? null }),
  filesRead: (scope: T.FileScope, path: string) => call<T.FileContent>("files_read", { scope, path }),
  /** Sichert die alte Fassung (max. 10 je Datei) und schreibt atomar */
  filesWrite: (scope: T.FileScope, path: string, content: string) => call<T.FileContent>("files_write", { scope, path, content }),
  /** Letzte Sicherung zurückspielen (aktuelle Fassung wird selbst gesichert -> rückgängig machbar) */
  filesRestore: (scope: T.FileScope, path: string) => call<T.FileContent>("files_restore", { scope, path }),
  filesValidate: (path: string, content: string) => call<T.FileValidationError[]>("files_validate", { path, content }),
  /** Bildvorschau als data-URL */
  filesImage: (scope: T.FileScope, path: string) => call<string>("files_image", { scope, path }),
  /** Liefert den neuen relativen Pfad */
  filesCreate: (scope: T.FileScope, dir: string, name: string, isDir: boolean) => call<string>("files_create", { scope, dir, name, isDir }),
  filesRename: (scope: T.FileScope, path: string, newName: string) => call<string>("files_rename", { scope, path, newName }),
  filesDuplicate: (scope: T.FileScope, path: string) => call<string>("files_duplicate", { scope, path }),
  /** In den Papierkorb; `permanent` löscht endgültig */
  filesDelete: (scope: T.FileScope, paths: string[], permanent = false) => call<T.FileDeleteOutcome>("files_delete", { scope, paths, permanent }),
  /** Externe Dateien/Ordner (absolute Pfade) nach `dir` kopieren; liefert die neuen relativen Pfade */
  filesImport: (scope: T.FileScope, dir: string, sources: string[]) => call<string[]>("files_import", { scope, dir, sources }),
  filesAbsPath: (scope: T.FileScope, path: string) => call<string>("files_abs_path", { scope, path }),
  filesReveal: (scope: T.FileScope, path: string) => call<void>("files_reveal", { scope, path }),
};
