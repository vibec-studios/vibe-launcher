export type AgentVia = "direct" | "vibe";
export type AgentConn = "connecting" | "online" | "offline" | "failed";

export interface RemoteAgent {
  key: string;
  id: string;
  name: string;
  via: AgentVia;
  address: string | null;
  fingerprint: string | null;
  version: string | null;
  os: string | null;
  arch: string | null;
  token_id: string | null;
  role: string | null;
  online: boolean | null;
  last_seen: number | null;
  added_at: number;
  conn: AgentConn | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  version: string;
  api_version?: number;
  os?: string;
  arch?: string;
  tls?: boolean;
  fingerprint?: string | null;
  paired?: boolean;
  gateway?: { enabled: boolean; connected: boolean };
  started_at?: number;
}

export interface AgentProbe {
  address: string;
  fingerprint: string;
  info: AgentInfo;
}

export interface LinkCode {
  code: string;
  expires_at: number;
}

export interface ServerRemote {
  agent: string;
  agent_name: string;
  via: AgentVia;
  host: string | null;
}
