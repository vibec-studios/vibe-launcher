import type { InstallState, Loader } from "./instances";

// ------------------------------------------------------------------ Lokale Server (OWNER Game-Agent)

/** Wie Freunde den Server erreichen */
export type ServerConnection = "local" | "relay" | "playit";

export interface Server {
  id: string;
  name: string;
  /** Absoluter Bildpfad (PNG) oder null = Standard */
  icon: string | null;
  accent: string | null;
  mc_version: string;
  loader: Loader;
  /** Plugin-Software (Paper/Purpur/Folia); gesetzt -> loader ist Vanilla */
  platform?: ServerPlatform | null;
  /** Arbeitsspeicher in MiB (null = Standard 2048) */
  memory_mb: number | null;
  /** Fester Java-Pfad (null = automatisch) */
  java_path: string | null;
  /** Zusätzliche JVM-Argumente */
  jvm_args: string | null;
  /** = server-port in server.properties */
  port: number;
  /** Beim Launcher-Start mitstarten */
  auto_start: boolean;
  /** Nach Absturz automatisch neu starten (max. 3× in 10 min) */
  auto_restart: boolean;
  connection: ServerConnection;
  /** Minecraft-EULA akzeptiert (eula.txt) */
  eula: boolean;
  install_state: InstallState;
  created_at: number;
  last_started: number | null;
  /** Instanz, aus der der Server erstellt wurde */
  source_instance: string | null;
  /** Sprachchat (Simple Voice Chat) über den Relay */
  voice?: boolean;
  /** Bedrock-Freunde (Geyser + Floodgate) über den Relay */
  bedrock?: boolean;
  remote?: { agent: string; agent_name: string; via: "direct" | "vibe"; host: string | null } | null;
}

export interface ServerExtras {
  voice: boolean;
  bedrock: boolean;
  voice_supported: boolean;
  bedrock_supported: boolean;
  voice_installed: boolean;
  bedrock_installed: boolean;
}

export interface UdpChannel {
  host: string;
  port: number;
  address: string;
}

/** Sprachchat/Bedrock über den Relay: waiting | connecting | ok | blocked | unavailable | off */
export interface UdpStatus {
  state: "waiting" | "connecting" | "ok" | "blocked" | "unavailable" | "off";
  voice: UdpChannel | null;
  bedrock: UdpChannel | null;
  denied: { channel: string; code: "disabled" | "no_port" | "limit" | string }[];
}

export type ServerRunState = "stopped" | "starting" | "running" | "stopping" | "crashed";

export type TunnelState = "connecting" | "online" | "claim" | "error" | "stopped";

export interface TunnelStatus {
  kind: ServerConnection;
  state: TunnelState;
  /** Öffentliche Adresse für Freunde (Relay/playit) */
  address: string | null;
  /** playit: Link zum Bestätigen im Browser */
  claim_url: string | null;
  /** Fehler-/Hinweistext (deutsch) */
  message: string | null;
  /** Sprachchat/Bedrock über den Relay */
  udp?: UdpStatus | null;
}

/** Payload von `server://status` */
export interface ServerStatus {
  server_id: string;
  state: ServerRunState;
  pid: number | null;
  started_at: number | null;
  /** Namen der Spieler online */
  players: string[];
  max_players: number | null;
  exit_code: number | null;
  /** Läuft noch aus einer früheren Launcher-Sitzung (keine Konsole, Stopp = Beenden) */
  detached: boolean;
  tunnel: TunnelStatus | null;
}

export interface ServerAddresses {
  /** z. B. "localhost:25565" */
  local: string;
  /** LAN-Adressen "192.168.1.20:25565" */
  lan: string[];
}

export type ModSide = "both" | "client" | "server" | "unknown";

/** Mod einer Instanz mit Einordnung für den Server */
export interface ServerModCandidate {
  file_name: string;
  name: string | null;
  side: ModSide;
  /** Mod ist in der Instanz aktiv */
  enabled: boolean;
  /** Vorschlag: auf den Server kopieren */
  server_ok: boolean;
}

export type ServerPlatformKind = "paper" | "purpur" | "folia";

export interface ServerPlatform {
  kind: ServerPlatformKind;
  /** Build-Nummer; null = neuester stabiler */
  build: string | null;
}

export interface ServerCreate {
  name: string;
  mc_version: string;
  loader: Loader;
  platform?: ServerPlatform | null;
  /** Aus Instanz erstellen (Version/Loader der Instanz werden übernommen) */
  from_instance?: string | null;
  /** Dateinamen aus mods/ der Instanz, die kopiert werden (null = automatische Auswahl) */
  mods?: string[] | null;
  /** config/ und defaultconfigs/ der Instanz kopieren */
  copy_configs?: boolean;
  /** Ordnername unter saves/ der Instanz – wird die Server-Welt */
  world?: string | null;
  port?: number | null;
  memory_mb?: number | null;
}

/** Nur gesetzte Felder werden übernommen; `null` setzt optionale Felder zurück. */
export interface ServerPatch {
  name?: string;
  accent?: string | null;
  memory_mb?: number | null;
  java_path?: string | null;
  jvm_args?: string | null;
  port?: number;
  auto_start?: boolean;
  auto_restart?: boolean;
  connection?: ServerConnection;
}

export interface ServerCreated {
  server: Server;
  /** Task-ID der Installation (TaskInfo.instance_id = "server:<id>") */
  task_id: string;
}

export interface ServerPlayerEntry {
  name: string;
  uuid: string | null;
  /** OP-Level (nur ops) */
  level: number | null;
  /** Bann-Grund */
  reason: string | null;
}

export interface ServerPlayers {
  online: string[];
  whitelist_enabled: boolean;
  whitelist: ServerPlayerEntry[];
  ops: ServerPlayerEntry[];
  banned: ServerPlayerEntry[];
  /** name = IP-Adresse */
  banned_ips: ServerPlayerEntry[];
}

export type ServerPlayerList = "whitelist" | "ops" | "banned" | "banned_ips";

export interface ServerWorld {
  /** Ordnername */
  name: string;
  size: number;
  /** = level-name */
  active: boolean;
}

export interface ServerBackup {
  /** Dateiname im backups/-Ordner */
  name: string;
  world: string;
  size: number;
  created: number;
}
