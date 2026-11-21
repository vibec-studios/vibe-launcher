import type { VibeClient, VibeGateway } from "@/lib/vibe-sdk";
import { VibeError } from "@/lib/vibe-sdk";
import { keyringTokenStore } from "@/lib/vibe-sdk/tauri";
import { t } from "@/i18n";

// ------------------------------------------------------------------ Konfiguration / Lebenszyklus

export interface VibeConfig {
  enabled: boolean;
  social: boolean;
  presence: boolean;
  sharing: boolean;
  hosting: boolean;
}

export const MAX_AUTO_TRIES = 2;

export const rt = {
  client: null as VibeClient | null,
  gateway: null as VibeGateway | null,
  clientKey: "",
  tokens: keyringTokenStore(),
  cfg: { enabled: false, social: false, presence: false, sharing: false, hosting: false } as VibeConfig,
  offGateway: [] as (() => void)[],
  cfgSeq: 0,
  autoTries: 0,
  autoAllowed: true,
  retryTimer: null as ReturnType<typeof setTimeout> | null,
  retryDelay: 30_000,
  failedAttempts: 0,
  lastPresence: "",
};

/** Aktueller Client (null = Dienste aus / kein Account). */
export function vibeClient(): VibeClient | null {
  return rt.client;
}

/** Client oder Fehler (für Mutationen). */
export function requireClient(): VibeClient {
  if (!rt.client) throw new Error(t("social.err.not_connected"));
  return rt.client;
}

export function gatewayWanted() {
  return rt.cfg.enabled && (rt.cfg.social || rt.cfg.presence);
}

export function isLoopback(url: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function clearRetry() {
  if (rt.retryTimer) clearTimeout(rt.retryTimer);
  rt.retryTimer = null;
  rt.retryDelay = 30_000;
}

export function errText(e: unknown): string {
  if (e instanceof VibeError) return e.status === 0 ? t("social.err.offline") : e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
