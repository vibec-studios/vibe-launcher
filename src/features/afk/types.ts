export type AfkMode = "background" | "foreground";
export type AfkAgent = "pending" | "active" | "missing" | "unsupported";
export type AfkVia = "agent" | "system" | "options" | "log" | "none";

export interface AfkSettings {
  enabled: boolean;
  always_ready: boolean;
  notify: boolean;
  auto_reconnect: boolean;
  options_fallback: boolean;
}

export const AFK_DEFAULTS: AfkSettings = { enabled: false, always_ready: true, notify: true, auto_reconnect: false, options_fallback: true };

export interface AfkFeatures {
  window: boolean;
  fps: boolean;
  sound: boolean;
  chat_read: boolean;
  chat_send: boolean;
  reconnect: boolean;
  game_state?: boolean;
}

export interface AfkStatus {
  screen?: "loading" | "menu" | "world" | "death" | "disconnected" | "connecting" | "unknown";
  player?: string;
  dead?: boolean;
  connected?: boolean;
  server?: string | null;
  world?: string;
  health?: number;
  max_health?: number;
  food?: number;
  dimension?: string;
  updated_at?: number;
}

export interface AfkSession {
  run_id: string;
  instance_id: string;
  requested: boolean;
  mode: AfkMode;
  mode_at: number;
  agent: AfkAgent;
  agent_version: string | null;
  features: AfkFeatures;
  window: "agent" | "system" | null;
  window_hidden: boolean;
  overlay: boolean;
  can_send: boolean;
  status: AfkStatus;
  events: number;
  ended: boolean;
}

export interface AfkEvent {
  ts: number;
  type: string;
  text?: string;
  sender?: string;
  kind?: "chat" | "system" | "whisper";
  message?: string;
  reason?: string;
  source?: "log" | "game";
  fallback?: boolean;
  seq?: number;
  error?: string;
  health?: number;
  max_health?: number;
  food?: number;
  attempt?: number;
  left?: boolean;
  id?: string;
  ok?: boolean;
  value?: number;
  [key: string]: unknown;
}

export interface AfkSupport {
  supported: boolean;
  agent: "ready" | "download" | "unsupported" | "none";
  agent_version: string | null;
  window: AfkVia;
  fps: AfkVia;
  sound: AfkVia;
  chat_read: AfkVia;
  chat_send: boolean;
  reconnect: boolean;
}

export const CHAT_TYPES = new Set(["chat", "outgoing"]);
export const NOTABLE_TYPES = new Set([
  "agent_start",
  "connect",
  "disconnect",
  "death",
  "respawn",
  "mention",
  "whisper",
  "health_low",
  "food_low",
  "reconnect_attempt",
  "reconnect_gave_up",
  "outbox_ack",
  "chat_dropped",
  "error",
]);
