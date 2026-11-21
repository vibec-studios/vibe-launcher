import type { HostPrivacy, HostRole, HostSessionPack } from "../types-social";
import type { PublicUser } from "./users";

// ---------- Hosting ----------

export interface HostPlayer {
  name: string;
  uuid: string | null;
  joinedAt: string;
}

export interface HostSession {
  id: string;
  host: PublicUser;
  kind: "world" | "server";
  client: "mod" | "launcher";
  slot: number;
  address: string | null;
  mcVersion: string | null;
  status: "authorized" | "online" | "ended";
  players: HostPlayer[];
  maxPlayers: number | null;
  startedAt: string;
  onlineAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  worldName?: string | null;
  privacy?: HostPrivacy;
  myRole?: HostRole | null;
  pack?: HostSessionPack | null;
}

export interface HostingLimits {
  enabled: boolean;
  maxHosts: number;
  maxPlayersPerHost: number | null;
  active: number;
}
