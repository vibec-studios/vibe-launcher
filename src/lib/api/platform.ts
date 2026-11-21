import { call } from "./call";
import type * as T from "../types";

export const platformApi = {
  // ---------------------------------------------------------------- Screenshots
  screenshotsList: (instanceId?: string | null) => call<T.Screenshot[]>("screenshots_list", { instanceId: instanceId ?? null }),
  /** Pfad eines gecachten Vorschaubilds (JPEG, max. 480×360) */
  screenshotThumb: (path: string) => call<string>("screenshot_thumb", { path }),
  screenshotDelete: (path: string) => call<void>("screenshot_delete", { path }),
  screenshotCopy: (path: string) => call<void>("screenshot_copy", { path }),
  screenshotOpenFolder: (path: string) => call<void>("screenshot_open_folder", { path }),

  serverExtrasGet: (id: string) => call<T.ServerExtras>("server_extras_get", { id }),
  /** Sprachchat/Bedrock ein-/ausschalten (installiert bzw. deaktiviert die Erweiterungen) */
  serverExtrasSet: (id: string, patch: { voice?: boolean; bedrock?: boolean }) =>
    call<T.ServerExtras>("server_extras_set", { id, voice: patch.voice ?? null, bedrock: patch.bedrock ?? null }),

  // ---------------------------------------------------------------- Plattform (Crash-Analyse, Server, Statistik …)
  crashAnalyze: (instanceId: string, crashReport?: string | null, exitCode?: number | null) =>
    call<T.Diagnosis[]>("crash_analyze", { instanceId, crashReport: crashReport ?? null, exitCode: exitCode ?? null }),
  instanceServersList: (instanceId: string) => call<T.ServerEntry[]>("instance_servers_list", { instanceId }),
  instanceServersSave: (instanceId: string, servers: T.ServerEntry[]) => call<void>("instance_servers_save", { instanceId, servers }),
  /** Domain-Umzug: Adressen `*.vibey.henny.dev` auf `*.axolite.cc` umstellen. Anzahl geänderter Einträge */
  instanceServersModernize: (instanceId: string) => call<number>("instance_servers_modernize", { instanceId }),
  serverPing: (address: string) => call<T.ServerPing>("server_ping", { address }),
  serversRecent: (limit?: number) => call<T.RecentServer[]>("servers_recent", { limit: limit ?? null }),
  playtimeSessions: (since?: number | null) => call<T.PlaySession[]>("playtime_sessions", { since: since ?? null }),
  optsyncGet: () => call<T.OptSyncInfo>("optsync_get"),
  optsyncSetInstance: (instanceId: string, enabled: boolean, categories: T.SyncKey[]) =>
    call<T.OptSyncInfo>("optsync_set_instance", { instanceId, enabled, categories }),
  optsyncCapture: (instanceId: string, categories: T.SyncKey[]) => call<T.OptSyncInfo>("optsync_capture", { instanceId, categories }),
  optsyncApplyAll: () => call<number>("optsync_apply_all"),
  /** Ordner/Server/Screenshots abgleichen: eine Instanz oder alle (null) */
  optsyncSyncNow: (instanceId?: string | null) => call<T.SyncAllResult>("optsync_sync_now", { instanceId: instanceId ?? null }),
  optsyncOpenFolder: (area: T.SyncArea) => call<void>("optsync_open_folder", { area }),
  optsyncClearConflicts: (instanceId: string) => call<T.OptSyncInfo>("optsync_clear_conflicts", { instanceId }),
  shortcutCreate: (instanceId: string, location: "desktop" | "start_menu") => call<string>("shortcut_create", { instanceId, location }),
  appActionsTake: () => call<T.AppAction[]>("app_actions_take"),
  // ---------------------------------------------------------------- Spiel-Links
  /** Abgelaufen/unbekannt: Fehler `{ kind: "not_found" }` */
  playLinkGet: (code: string) => call<T.PlayLink>("play_link_get", { code }),
  playJoinPreview: (link: T.PlayLink) => call<T.JoinPreview>("play_join_preview", { link }),
  /** Task-ID; die Instanz steht danach in `task.instance_id` */
  playJoinSetup: (link: T.PlayLink, instanceId: string | null) => call<string>("play_join_setup", { link, instanceId }),
  playSessions: () => call<T.RunningSession[]>("play_sessions"),
  discordAvailable: () => call<boolean>("discord_available"),
};
