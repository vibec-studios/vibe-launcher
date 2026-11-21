import type { PublicUser } from "./users";

// ---------- Einladungen ----------

export type InviteKind = "world" | "server" | "party" | "modpack";
export type InviteStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface InviteTarget {
  name: string;
  mcVersion?: string | null;
  loader?: string | null;
  instanceName?: string | null;
  packCode?: string | null;
}

export interface Invite {
  id: string;
  kind: InviteKind;
  from: PublicUser;
  toUserId: string | null;
  chatId: string | null;
  target: InviteTarget;
  message: string | null;
  hostSessionId: string | null;
  status: InviteStatus;
  myResponse: "accepted" | "declined" | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInviteBody {
  kind: InviteKind;
  toUserIds?: string[];
  chatId?: string;
  target: InviteTarget;
  message?: string;
  hostSessionId?: string;
  connection?: { type: "relay" | "playit" | "direct"; address: string; port?: number };
  ttlMinutes?: number;
}

export interface AcceptInviteResult {
  invite: Invite;
  connection: { type: "relay" | "playit" | "direct"; address: string; port: number | null } | null;
  packCode: string | null;
}
