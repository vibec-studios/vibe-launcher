/** Gespeicherte Anmeldedaten. `expiresAt` = Ablauf des Access-Tokens (ms seit 1970). */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

/** Ablage für Tokens – z. B. OS-Keyring im Launcher, localStorage im Web. */
export interface TokenStore {
  get(): StoredTokens | null | Promise<StoredTokens | null>;
  set(tokens: StoredTokens | null): void | Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private t: StoredTokens | null = null;
  constructor(initial?: StoredTokens | null) {
    this.t = initial ?? null;
  }
  get() {
    return this.t;
  }
  set(t: StoredTokens | null) {
    this.t = t;
  }
}

export interface VibeClientOptions {
  /** z. B. "https://vibe.axolite.app" */
  baseUrl: string;
  tokens?: TokenStore;
  /** eigene fetch-Implementierung (z. B. Tauri-HTTP-Plugin) */
  fetch?: typeof fetch;
  /** Wird aufgerufen, wenn die Anmeldung endgültig verloren ist (Refresh fehlgeschlagen, gesperrt, abgemeldet). */
  onAuthLost?: (reason: { code: string; message: string }) => void;
  /** Wird nach jedem Login/Refresh mit den neuen Tokens aufgerufen. */
  onTokens?: (tokens: StoredTokens | null) => void;
  /** Timeout pro Anfrage in ms (Standard 15000) */
  timeoutMs?: number;
}
