import type { LogLine, Permission, Role, Server, ServerStatus } from "./server";

export interface AgentUpdate {
  current: string;
  latest: string | null;
  available: boolean;
  self_update: boolean;
  notes_url: string | null;
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
  hostname: string | null;
  gateway: { enabled: boolean; connected: boolean; linked: boolean };
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
  via: "direct" | "gateway";
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
  bind: string;
  tls: boolean;
  data_dir: string;
  gateway_enabled: boolean;
  hosting: boolean;
  auto_java: boolean;
  curseforge_configured: boolean;
  relay: RelayIdentityInfo;
}

export interface GatewayStatus {
  enabled: boolean;
  connected: boolean;
  linked: boolean;
  agent_id: string | null;
  vibe_user: { id: string; name: string | null } | null;
  last_error: string | null;
}

export interface Invite {
  code: string;
  expires_at: number;
  role: Role;
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
