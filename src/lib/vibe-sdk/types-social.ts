// Typen aus vibe-backend `feat/w3-social` (packages/shared: pack-follow, host-panel, access-invites, playlinks).
import type { HostPlayer, HostSession, Pack, PackVersion, PublicUser } from "./types";

// ---------- Pack folgen / Diff ----------

export interface PackFollow {
  pack: Pack;
  notify: boolean;
  installedVersionId: string | null;
  updateAvailable: boolean;
  followedAt: string;
  updatedAt: string;
}

export interface FollowPackBody {
  notify?: boolean;
  installedVersionId?: string | null;
}

export type PackDiffCategory = "mod" | "resourcepack" | "shader" | "datapack" | "config" | "other";

export interface PackDiffFile {
  path: string;
  source: string;
  project_id: string | null;
  version_id: string | null;
  url: string;
  sha1: string | null;
  size: number | null;
}

export interface PackDiffEntry extends PackDiffFile {
  key: string;
  category: PackDiffCategory;
}

export interface PackDiffLoader {
  kind: string;
  version: string | null;
}

export interface PackDiff {
  from: PackVersion;
  to: PackVersion;
  mcVersion: { from: string; to: string } | null;
  loader: { from: PackDiffLoader; to: PackDiffLoader } | null;
  added: PackDiffEntry[];
  removed: PackDiffEntry[];
  updated: (PackDiffEntry & { previous: PackDiffFile })[];
  overridesChanged: boolean;
  summary: { added: number; removed: number; updated: number; unchanged: number };
}

export interface PackVersionPublishedEvent {
  pack: Pack;
  version: PackVersion;
  previousVersionId: string | null;
  summary: PackDiff["summary"] | null;
}

export interface PackRemovedEvent {
  code: string;
  reason: "deleted" | "hidden" | "removed" | "visibility";
}

// ---------- Hosting-Panel ----------

export type HostPrivacy = "invite" | "friends" | "public";
export type HostRole = "host" | "member" | "guest";

export interface HostSessionPack {
  code: string;
  versionId: string | null;
  name: string;
}

export interface HostPolicy {
  privacy: HostPrivacy;
  defaultRole: "guest" | "member";
  maxPlayers: number | null;
}

export interface HostMember {
  uuid: string;
  name: string;
  role: "member" | "guest";
  user: PublicUser | null;
  addedAt: string;
}

export interface HostKick {
  uuid: string | null;
  name: string;
  reason: string | null;
  permanent: boolean;
  at: string;
}

export type HostSessionEventType = "join" | "leave" | "kick" | "unkick" | "role" | "privacy" | "denied";

export interface HostSessionEvent {
  id: string;
  sessionId: string;
  type: HostSessionEventType;
  actor: PublicUser | null;
  player: { uuid: string | null; name: string } | null;
  data: Record<string, unknown> | null;
  at: string;
}

export interface HostPanel {
  session: HostSession;
  policy: HostPolicy;
  members: HostMember[];
  kicks: HostKick[];
  players: (HostPlayer & { role: HostRole })[];
  myRole: HostRole;
}

export interface UpdateHostPolicyBody {
  privacy?: HostPrivacy;
  defaultRole?: "guest" | "member";
  maxPlayers?: number | null;
}

export interface SetHostMemberBody {
  role: "member" | "guest";
  name?: string;
}

export interface KickPlayerBody {
  player: string;
  reason?: string;
  permanent?: boolean;
}

export interface UpdateHostSessionBody {
  worldName?: string | null;
  pack?: { code: string; versionId?: string } | null;
}

export type JoinDecision = { allow: true; role: HostRole } | { allow: false; code: "kicked" | "not_friend" | "not_invited"; message: string };

export interface HostPanelUpdatedEvent {
  sessionId: string;
  policy: HostPolicy;
  members: HostMember[];
  kicks: HostKick[];
}

export interface HostKickEvent {
  sessionId: string;
  hostId: string;
  player: { uuid: string | null; name: string };
  reason: string | null;
  permanent: boolean;
}

// ---------- Beta-Einladungen ----------

export type AccessInviteStatus = "pending" | "redeemed" | "revoked" | "expired";

export interface AccessInvite {
  id: string;
  code: string;
  url: string;
  deepLink: string;
  name: string | null;
  status: AccessInviteStatus;
  redeemedBy: PublicUser | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
}

export interface AccessInviteQuota {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  invites: AccessInvite[];
}

export interface AccessInvitePreview {
  code: string;
  inviter: { uuid: string; name: string };
  name: string | null;
  valid: boolean;
  status: AccessInviteStatus;
  expiresAt: string;
}

// ---------- Spiel-Links ----------

export interface PlayLinkVibePack {
  code: string;
  version_id: string;
  version: string;
  name: string;
  icon_url: string | null;
  mc_version: string;
  loader: string;
  loader_version: string | null;
  file_count: number;
  download_url: string;
  overrides_url: string | null;
  overrides_sha256: string | null;
  overrides_size: number | null;
  latest_version_id: string | null;
  available: boolean;
}

export interface PlayLinkMod {
  source: string;
  project_id: string;
  version_id?: string | null;
  kind?: string;
}

export interface PlayLinkInfo {
  code: string;
  url: string;
  host: { uuid: string; name: string };
  relay_host: string;
  mc_version: string;
  loader: { kind: string; version: string | null };
  pack: { source: string; project_id: string; version_id: string; title?: string | null } | null;
  mods: PlayLinkMod[];
  client_pack: string | null;
  world_name: string | null;
  max_players: number | null;
  active: boolean;
  expires_at: string;
  created_at?: string;
  vibe_pack?: PlayLinkVibePack | null;
}

export interface CreatePlayLinkBody {
  relay_host: string;
  mc_version: string;
  loader: { kind: string; version: string | null };
  pack?: PlayLinkInfo["pack"];
  vibe_pack?: { code: string; version_id?: string };
  mods?: PlayLinkMod[];
  client_pack?: string | null;
  world_name?: string | null;
  max_players?: number | null;
}

export interface CreatedPlayLink {
  code: string;
  url: string;
  expires_at: string;
}
