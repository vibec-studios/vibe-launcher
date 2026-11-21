// ---------- Presence ----------

export type PresenceStatusSetting = "online" | "away" | "busy" | "invisible";
export type PresenceStatus = "online" | "away" | "busy" | "offline";

export interface JoinInfo {
  type: "relay" | "playit" | "direct" | "invite";
  address: string | null;
  port?: number | null;
  hostSessionId?: string | null;
}

export interface Activity {
  type: "playing" | "launcher" | "hosting";
  instanceId?: string | null;
  instanceName?: string | null;
  mcVersion?: string | null;
  loader?: string | null;
  server?: string | null;
  world?: string | null;
  joinable?: boolean;
  join?: JoinInfo | null;
  startedAt?: string | null;
}

export interface Presence {
  userId: string;
  status: PresenceStatus;
  activity: Activity | null;
  updatedAt: string;
}

export interface SetPresenceBody {
  status?: PresenceStatusSetting;
  activity?: Activity | null;
}
