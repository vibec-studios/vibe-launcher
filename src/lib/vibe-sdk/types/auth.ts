import type { Me } from "./users";

// ---------- Auth ----------

export interface ChallengeResult {
  serverId: string;
  expiresAt: string;
}

export interface TokenPair {
  accessToken: string;
  /** Sekunden bis zum Ablauf des Access-Tokens */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  sessionId: string;
}

export interface AuthResult extends TokenPair {
  user: Me;
  created: boolean;
}
