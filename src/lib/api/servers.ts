import { call } from "./call";
import type * as T from "../types";

export const serversApi = {
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
};
