export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";
export type PlatformKind = "paper" | "purpur" | "folia";
export type Software = LoaderKind | PlatformKind;
export type InstallState = "not_installed" | "installing" | "installed" | "failed";
export type ServerConnection = "local" | "relay" | "playit";
export type ServerRunState = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type TunnelState = "connecting" | "online" | "claim" | "error" | "stopped";
export type Role = "owner" | "admin" | "operator" | "viewer";
export type Permission = "servers.read" | "servers.control" | "servers.manage" | "files.read" | "files.write" | "agent.admin";

export interface Loader {
  kind: LoaderKind;
  version: string | null;
}

export interface ServerPlatform {
  kind: PlatformKind;
  build: string | null;
}

export interface Server {
  id: string;
  name: string;
  icon: string | null;
  accent: string | null;
  mc_version: string;
  loader: Loader;
  platform: ServerPlatform | null;
  memory_mb: number | null;
  java_path: string | null;
  jvm_args: string | null;
  port: number;
  auto_start: boolean;
  auto_restart: boolean;
  connection: ServerConnection;
  eula: boolean;
  install_state: InstallState;
  created_at: number;
  last_started: number | null;
  source_instance: string | null;
  relay_slot?: number;
  voice?: boolean;
  bedrock?: boolean;
}

export interface UdpChannel {
  host: string;
  port: number;
  address: string;
}

export interface UdpStatus {
  state: "waiting" | "connecting" | "ok" | "blocked" | "unavailable" | "off";
  voice: UdpChannel | null;
  bedrock: UdpChannel | null;
  denied: { channel: string; code: string }[];
}

export interface TunnelStatus {
  kind: ServerConnection;
  state: TunnelState;
  address: string | null;
  claim_url: string | null;
  message: string | null;
  udp?: UdpStatus | null;
}

export interface ServerStatus {
  server_id: string;
  state: ServerRunState;
  pid: number | null;
  started_at: number | null;
  players: string[];
  max_players: number | null;
  exit_code: number | null;
  detached: boolean;
  tunnel: TunnelStatus | null;
}

export type ServerView = Server & { status: ServerStatus | null };

export interface ServerAddresses {
  local: string;
  lan: string[];
  public: string | null;
  relay: string | null;
}

export interface ServerCreate {
  name: string;
  mc_version: string;
  loader: Loader;
  platform?: ServerPlatform | null;
  port?: number | null;
  memory_mb?: number | null;
}

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
  task_id: string;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "stdout" | "stderr" | "launcher";

export interface LogLine {
  seq: number;
  time: string | null;
  level: LogLevel;
  thread: string | null;
  logger: string | null;
  text: string;
}

export interface ServerPlayerEntry {
  name: string;
  uuid: string | null;
  level: number | null;
  reason: string | null;
}

export interface ServerPlayers {
  online: string[];
  whitelist_enabled: boolean;
  whitelist: ServerPlayerEntry[];
  ops: ServerPlayerEntry[];
  banned: ServerPlayerEntry[];
  banned_ips: ServerPlayerEntry[];
}

export type ServerPlayerList = "whitelist" | "ops" | "banned" | "banned_ips";

export interface ServerWorld {
  name: string;
  size: number;
  active: boolean;
}

export interface ServerBackup {
  name: string;
  world: string;
  size: number;
  created: number;
}
