// ---------------------------------------------------------------- Vibe-Dienste (commands/vibe.rs)

export interface VibeServices {
  /** Hauptschalter: aus = keine Verbindung zum Vibe-Backend/Relay */
  enabled: boolean;
  social: boolean;
  presence: boolean;
  hosting: boolean;
  sharing: boolean;
}

export interface VibeIdentity {
  /** Account-ID bzw. `dev-<name>` (nur Debug) */
  scope: string;
  name: string;
  uuid: string;
  dev: boolean;
}

export interface VibeStatus {
  enabled: boolean;
  /** Backend-Adresse (immer das offizielle Backend; nur Debug-Builds: Env `VIBE_API_URL`) */
  api_url: string;
  gateway_url: string;
  identity: VibeIdentity | null;
  logged_in: boolean;
}

/** Ankündigung des Backends (`GET /api/v1/announcements`, in Rust geprüft; docs/DOMAINS.md) */
export interface Announcement {
  id: string;
  level: "info" | "warn";
  title: string;
  body: string;
  /** Nur https */
  url: string | null;
}

/** Wie `StoredTokens` im SDK */
export interface VibeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

export interface VibeHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
}

export interface VibeHttpResponse {
  status: number;
  body: string;
  content_type: string | null;
  retry_after: string | null;
}

export type VibeWsEvent =
  | { type: "open"; id: string }
  | { type: "message"; id: string; data: string }
  | { type: "close"; id: string; code: number; reason: string };

export interface VibeShareOptions {
  visibility?: "public" | "unlisted" | "friends";
  description?: string | null;
  changelog?: string | null;
  /** Vorhandenes Pack: neue Version */
  code?: string | null;
  version?: string | null;
}

export interface VibeShareLink {
  code: string;
  url: string | null;
}
