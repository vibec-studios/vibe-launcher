import type { PublicUser } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";

/** Mehrere kleine Köpfe übereinander (Gruppen). */
export function AvatarStack({ users, size = 18, max = 3, ring = "var(--canvas)" }: { users: PublicUser[]; size?: number; max?: number; ring?: string }) {
  return (
    <span className="flex items-center -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <span key={u.id} className="rounded-xs" style={{ boxShadow: `0 0 0 2px ${ring}` }}>
          <Avatar user={u} size={size} />
        </span>
      ))}
    </span>
  );
}
