// ---------- Allgemein ----------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; retryAfter?: number };
}

// ---------- Nutzer ----------

export type PrivacyLevel = "everyone" | "friends_of_friends" | "friends" | "nobody";

export interface Privacy {
  friendRequests: PrivacyLevel;
  directMessages: PrivacyLevel;
  invites: PrivacyLevel;
  showHosting: boolean;
}

export interface Skin {
  url: string | null;
  model: "classic" | "slim";
  capeUrl: string | null;
}

export type UserBadge = "user" | "supporter" | "staff";

export interface PublicUser {
  /** Minecraft-UUID mit Bindestrichen */
  id: string;
  name: string;
  skin: Skin;
  statusText: string | null;
  badge: UserBadge;
  createdAt: string;
}

export interface EffectiveLimits {
  maxHosts: number;
  maxPlayersPerHost: number | null;
  maxPacks: number;
  maxFriends: number;
  maxPackOverridesMb: number;
}

export interface Me extends PublicUser {
  privacy: Privacy;
  limits: EffectiveLimits;
  presenceStatus: "online" | "away" | "busy" | "invisible";
}

export interface UpdateMeBody {
  statusText?: string | null;
  privacy?: Partial<Privacy>;
}

export type Relationship = "none" | "friend" | "incoming" | "outgoing" | "blocked" | "blocked_by" | "self";

export interface UserWithRelationship extends PublicUser {
  relationship: Relationship;
}

export interface ClientInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DeviceSession {
  id: string;
  client: ClientInfo;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface ServerMeta {
  name: string;
  version: string;
  apiVersion: 1;
  motd: string | null;
  features: { registration: boolean; chat: boolean; sharing: boolean; hosting: boolean; invites: boolean };
  limits: { chatMessageMaxLength: number; maxGroupMembers: number };
  publicUrl: string;
}
