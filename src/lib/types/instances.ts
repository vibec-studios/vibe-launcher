// ------------------------------------------------------------------ Instanzen

export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface Loader {
  kind: LoaderKind;
  version: string | null;
}

export interface JavaOptions {
  path: string | null;
  min_memory_mb: number | null;
  max_memory_mb: number | null;
  jvm_args: string | null;
  env: Record<string, string>;
}

export interface WindowOptions {
  width: number | null;
  height: number | null;
  fullscreen: boolean | null;
}

/** Start-Hooks je Instanz (Befehle in der System-Shell im Spielordner). */
export interface LaunchHooks {
  pre_launch: string | null;
  post_exit: string | null;
  /** Wrapper vor Java; ersetzt den globalen */
  wrapper: string | null;
}

export type PackSourceKind = "modrinth" | "curseforge" | "vlpack" | "prism" | "local" | "vibe" | "packwiz";

export interface PackSource {
  kind: PackSourceKind;
  project_id: string | null;
  version_id: string | null;
  name: string | null;
  version_name: string | null;
}

export type InstallState = "not_installed" | "installing" | "installed" | "failed";

export interface Instance {
  id: string;
  name: string;
  icon: string | null;
  accent: string | null;
  group: string | null;
  mc_version: string;
  loader: Loader;
  java: JavaOptions;
  window: WindowOptions;
  /** Fehlt bei älteren Mock-Daten */
  hooks?: LaunchHooks;
  source: PackSource | null;
  install_state: InstallState;
  version_id: string | null;
  created_at: number;
  last_played: number | null;
  play_time_secs: number;
  notes: string | null;
  /** Inhalte vor dem Start aktualisieren; null = globale Einstellung (Modpacks: aus) */
  auto_update_content: boolean | null;
  /** Gesetzt = Minecraft-Bedrock-Instanz (Loader/Java/Fenster ohne Bedeutung). Fehlt bei älteren Daten = Java. */
  bedrock?: BedrockOptions | null;
}

export type BedrockChannel = "release" | "preview";
/** isolated = eigene Welten/Packs/Einstellungen (Tausch vor dem Start), shared = normale Bedrock-Daten */
export type BedrockProfile = "isolated" | "shared";
export interface BedrockOptions {
  channel: BedrockChannel;
  profile: BedrockProfile;
}

export interface CreateInstance {
  name: string;
  mc_version: string;
  loader: Loader;
  icon?: string | null;
  accent?: string | null;
  group?: string | null;
}

/** Nur gesetzte Felder werden übernommen. `null` bei optionalen Feldern = zurücksetzen. */
export interface InstancePatch {
  /** Nur bei Bedrock-Instanzen wirksam */
  bedrock?: BedrockOptions;
  name?: string;
  icon?: string | null;
  accent?: string | null;
  group?: string | null;
  mc_version?: string;
  loader?: Loader;
  java?: JavaOptions;
  window?: WindowOptions;
  hooks?: LaunchHooks;
  notes?: string | null;
  auto_update_content?: boolean | null;
}
