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
  relay_slot?: string | null;
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

export interface FileEntry {
  name: string;
  dir: boolean;
  size: number;
  modified: number;
}

export interface FileListing {
  path: string;
  entries: FileEntry[];
}

export type AddonSource = "modrinth" | "hangar";

export interface AddonTarget {
  folder: "plugins" | "mods";
  plugins: boolean;
  loaders: string[];
  mc: string;
  hangar: string | null;
}

export interface Addon {
  file_name: string;
  enabled: boolean;
  size: number;
  modified: number;
  name: string | null;
  version: string | null;
  authors: string[];
  description: string | null;
  icon: string | null;
  source: AddonSource | null;
  project_id: string | null;
  title: string | null;
  page_url: string | null;
}

export interface AddonList {
  target: AddonTarget;
  items: Addon[];
}

export interface AddonCompat {
  ok: boolean;
  reason: string | null;
  version: string | null;
}

export interface AddonHit {
  source: AddonSource;
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  updated: string | null;
  page_url: string;
  compat?: AddonCompat | null;
}

export interface AddonSearch {
  hits: AddonHit[];
  total: number;
  offset: number;
}

export interface McVersion {
  id: string;
  type: string;
  release_time: string | null;
}

export interface PlatformVersion {
  id: string;
  release: boolean;
  supported: boolean;
  java_min: number | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  version: string;
  api_version: number;
  min_api_version: number;
  os: string;
  arch: string;
  tls: boolean;
  fingerprint: string | null;
  paired: boolean;
  gateway: { enabled: boolean; connected: boolean };
  started_at: number;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  servers: string[];
  created_at: number;
  vibe_user_id: string | null;
}

export interface Me {
  user: User;
  permissions: Permission[];
}

export interface PairResult {
  token: string;
  token_id: string;
  user: { id: string; name: string; role: Role };
  agent: { id: string; name: string; version: string; fingerprint: string | null };
}

export interface Resources {
  cpu_percent: number;
  cpu_cores: number;
  mem_total: number;
  mem_used: number;
  disk_total: number;
  disk_free: number;
  uptime_s: number;
  servers: { id: string; pid: number | null; cpu_percent: number; mem_bytes: number }[];
}

export interface TaskInfo {
  id: string;
  kind: string;
  title: string;
  instance_id: string | null;
  progress: number | null;
  message: string | null;
  status: "running" | "done" | "failed" | "cancelled";
  error: string | null;
  started_at: number;
  step?: string | null;
}

export interface RelayIdentityInfo {
  configured: boolean;
  source: "gateway" | "account" | null;
  name: string | null;
}

export interface AgentSettings {
  name: string;
  port: number;
  tls: boolean;
  gateway_enabled: boolean;
  relay: RelayIdentityInfo;
}

export interface GatewayStatus {
  enabled: boolean;
  connected: boolean;
  linked: boolean;
  vibe_user: { id: string; name: string } | null;
  last_error: string | null;
}

export interface Invite {
  code: string;
  expires_at: number;
}

export interface AuditEntry {
  at: number;
  user_id: string | null;
  user_name: string | null;
  ip: string | null;
  via: "direct" | "gateway" | "cli";
  action: string;
  target: string | null;
  ok: boolean;
  detail: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  kind?: string;
}

export interface AgentEventMap {
  "server://status": ServerStatus;
  "server://log": { server_id: string; lines: LogLine[] };
  "servers://changed": Server;
  "servers://removed": { id: string };
  "task://update": TaskInfo;
  "agent://resources": Resources;
}

export type AgentEventName = keyof AgentEventMap;

export interface VibeAccount {
  id: string;
  name: string;
  avatar_url?: string | null;
}

export interface GatewayAgent {
  id: string;
  name: string;
  hostname: string | null;
  os: string | null;
  version: string | null;
  online: boolean;
  lastSeenAt: number | null;
  owner: { id: string; name: string } | null;
  myRole: "owner" | "admin" | "viewer";
  summary: { servers?: number; running?: number; players?: number; cpuPercent?: number; memUsed?: number; memTotal?: number } | null;
  disabled: boolean;
}

export interface DeviceStart {
  code: string;
  deviceToken: string;
  expiresIn: number;
  interval: number;
}
