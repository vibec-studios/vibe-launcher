// ------------------------------------------------------------------ Plattform

export type DiagnosisAction =
  | { kind: "disable_mod"; file: string }
  /** Deaktivierte Abhängigkeit wieder aktivieren */
  | { kind: "enable_mod"; file: string; name: string | null }
  | { kind: "install_dependency"; mod_id: string; name: string | null }
  /** Installierte Mod auf passende Version tauschen (über „Probleme beheben“) */
  | { kind: "update_mod"; file: string; mod_id: string }
  /** Kaputte Config-Datei sichern und zurücksetzen (über „Probleme beheben“) */
  | { kind: "reset_config"; path: string }
  | { kind: "set_java"; major: number }
  | { kind: "increase_ram"; suggest_mb: number }
  | { kind: "update_drivers" }
  | { kind: "upload" };

export interface Diagnosis {
  /** missing_dependency | outdated_dependency | wrong_minecraft | wrong_loader | loader_version | mixin |
   *  mixin_conflict | mod_conflict | known_conflict | java_version | out_of_memory | heap_reserve | duplicate_mod |
   *  broken_config | graphics | suspected_mod | exit_code */
  id: string;
  confidence: number;
  culprit: { mod_id: string | null; name: string | null; file: string | null } | null;
  params: Record<string, string>;
  actions: DiagnosisAction[];
  evidence: string | null;
  /** Fundstelle: Datei (`logs/latest.log`, `crash-reports/…`, `console`) und Zeile */
  source?: string | null;
  line?: number | null;
  /** Regel aus patterns.toml */
  rule?: string | null;
}

export interface ServerEntry {
  name: string;
  /** host[:port] */
  ip: string;
  /** Base64-PNG (ohne data:-Präfix) */
  icon: string | null;
  accept_textures: boolean | null;
  hidden: boolean;
}

/** Ergebnis eines Server-List-Pings (Server-Liste der Instanz) */
export interface ServerPing {
  online: boolean;
  /** MOTD mit §-Farbcodes (§#rrggbb für Hex-Farben) */
  motd: string;
  players_online: number | null;
  players_max: number | null;
  players_sample: string[];
  version: string | null;
  protocol: number | null;
  /** data:image/png;base64,… */
  favicon: string | null;
  latency_ms: number | null;
  error: string | null;
}

export interface RecentServer {
  address: string;
  instance_id: string;
  last_played: number;
  play_time_secs: number;
}

export interface PlaySession {
  instance_id: string;
  start: number;
  end: number;
  world?: string | null;
  server?: string | null;
}

export type QuickMod = "spark" | "replaymod";

export type QuickModStatus =
  | { status: "unavailable" }
  | { status: "installed" }
  | { status: "disabled"; file: string }
  | { status: "available"; version_id: string; version: string };

export interface RunResources {
  run_id: string;
  cpu_percent: number | null;
  memory_bytes: number | null;
  spark_report: string | null;
}

export type OptSyncCategory = "controls" | "keybinds" | "sound" | "video" | "language" | "accessibility";
/** Weitere Sync-Bereiche (gemeinsame Ordner, Server-Liste) */
export type SyncArea = "resourcepacks" | "shaderpacks" | "servers" | "screenshots" | "hotbars" | "command_history";
export type SyncKey = OptSyncCategory | SyncArea;

export interface SyncConflict {
  at: number;
  area: SyncArea;
  /** Name, der den gemeinsamen Stand behält */
  name: string;
  /** Neuer Name der abweichenden Fassung aus der Instanz */
  renamed: string;
}

export interface OptSyncInfo {
  config: {
    master: Record<string, string>;
    source: string | null;
    updated_at: number | null;
    instances: Record<string, { enabled: boolean; categories: SyncKey[] }>;
    /** Aktive Resourcepacks (Reihenfolge wie in options.txt) */
    resource_packs?: string[] | null;
    shader?: { pack: string; enabled: boolean } | null;
    optifine?: Record<string, string>;
    legacy_keybinds?: Record<string, string>;
  };
  categories: OptSyncCategory[];
  areas: SyncArea[];
  counts: Partial<Record<SyncKey, number>>;
  /** Gemeinsame Ordner (servers: Anzahl Server, size 0) */
  shared: { area: SyncArea; count: number; size: number }[];
  states: Record<string, { last_sync: number | null; conflicts: SyncConflict[]; errors: string[] }>;
}

export interface SyncAllResult {
  instances: number;
  changes: number;
  conflicts: number;
  errors: string[];
  /** Übersprungen, weil sie laufen (Namen) */
  running: string[];
}

/** Bereiche eines Teil-Snapshots */
export type SnapshotScope = "mods" | "configs" | "resourcepacks" | "shaderpacks" | "datapacks" | "options";

/** Sicherung vor automatischen Mod-Änderungen */
export interface FixBackup {
  mode: "recommended" | "mods" | "all" | "custom" | "none";
  /** Nur bei "custom" */
  areas: SnapshotScope[];
}

/** Aktion von außen (Kommandozeile `--launch`, Deep-Link `vibelauncher://…`) – Frontend fragt immer nach. */
export type AppAction =
  | { kind: "install"; source: string; project_id: string; version: string | null }
  | { kind: "pack"; code: string }
  | { kind: "launch"; instance_id: string }
  | { kind: "join"; address: string; instance_id: string | null }
  | { kind: "invite"; id: string }
  | { kind: "play_link"; code: string }
  | { kind: "access_invite"; code: string }
  | { kind: "install_version"; source: string; version_id: string };
