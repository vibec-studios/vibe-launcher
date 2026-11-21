import type { Loader } from "./instances";

// ------------------------------------------------------------------ Import aus anderen Launchern

/** folder = beliebiger Spielordner (nur über launcherScanDir) */
export type LauncherKind = "modrinth" | "prism" | "multimc" | "curseforge" | "atlauncher" | "gdlauncher" | "norisk" | "folder";

export interface ExternalInstance {
  /** Instanzordner im fremden Launcher (Kennung für importExternal) */
  source_path: string;
  name: string;
  /** leer = unbekannt (dann warning gesetzt) */
  mc_version: string;
  loader: Loader;
  /** data:-URL */
  icon: string | null;
  mod_count: number;
  last_played: number | null;
  play_time_secs: number | null;
  size: number | null;
  warning: string | null;
  /** Vibe-Instanz-ID, falls schon importiert */
  imported_as: string | null;
  /** Einstellungen im fremden Launcher (null = keine gefunden) */
  settings?: ExtSettings | null;
}

/** Bereiche, die aus einem anderen Launcher übernommen werden können (Import und nachträglich). */
export type ExtSettingKey = "memory" | "java" | "jvm_args" | "env" | "window" | "hooks" | "notes" | "group";
/** Nur nachträglich: Spielzeit, Icon, Modpack-Herkunft */
export type ExtExtraKey = "playtime" | "icon" | "pack" | "mods";

export interface ExtSettings {
  min_memory_mb: number | null;
  max_memory_mb: number | null;
  java_path: string | null;
  java_version: string | null;
  jvm_args: string | null;
  env: Record<string, string>;
  width: number | null;
  height: number | null;
  fullscreen: boolean | null;
  pre_launch: string | null;
  post_exit: string | null;
  wrapper: string | null;
  notes: string | null;
  group: string | null;
  /** Bereiche, die aus den Standard-Einstellungen des fremden Launchers stammen */
  inherited: ExtSettingKey[];
}

/** Abweichung Vibe-Instanz ↔ fremder Launcher (Werte je Bereich, siehe extsettings.rs `part`). */
export interface SettingsChange {
  key: ExtSettingKey | ExtExtraKey;
  old: unknown;
  new: unknown;
  default_on: boolean;
  inherited: boolean;
}

/** Ordner/Datei der Quelle, die in Vibe fehlt oder in der Quelle neuer ist (Backend: content/gamedata.rs). */
export interface DataEntry {
  /** relativ zum Spielordner, z. B. "xaero", "options.txt", "saves/Meine Welt" */
  path: string;
  kind: "file" | "dir" | "world";
  /** Weltname aus level.dat */
  name: string | null;
  status: "missing" | "partial" | "newer" | "changed" | "removed";
  size: number;
  missing_files: number;
  missing_size: number;
  overwrite_files: number;
  overwrite_size: number;
  default_on: boolean;
}

export interface DataPick {
  path: string;
  overwrite: boolean;
}

export interface SettingsOffer {
  instance_id: string;
  instance_name: string;
  launcher: LauncherKind;
  launcher_name: string;
  source_path: string;
  changes: SettingsChange[];
  data: DataEntry[];
  notes: string[];
}

export interface ImportFailed {
  name: string;
  reason: string;
}

export interface ImportReport {
  launcher: string;
  at: number;
  files: number;
  bytes: number;
  mods: string[];
  jars: string[];
  from_cache: string[];
  failed: ImportFailed[];
  locked: string[];
  norisk_only: string[];
  unfit: string[];
  sync_packs: string[];
  warnings: string[];
}

export interface ExternalLauncher {
  id: LauncherKind;
  name: string;
  path: string;
  instances: ExternalInstance[];
}
