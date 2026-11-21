import type { PublicUser } from "./users";
import type { Presence } from "./presence";

// ---------- Freunde ----------

export interface Friend {
  user: PublicUser;
  since: string;
  presence: Presence;
}

export interface FriendRequest {
  id: string;
  from: PublicUser;
  to: PublicUser;
  createdAt: string;
  direction: "incoming" | "outgoing";
}
