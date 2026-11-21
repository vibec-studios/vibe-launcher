import { MessageSquare } from "lucide-react";
import { memo, type ReactNode } from "react";
import { ContextMenu, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Friend } from "@/lib/vibe-sdk";
import { useFriends } from "../hooks";
import { usePresenceText } from "../presence";
import { useSocial } from "../service";
import { FriendMenuItems, isActive, startDm } from "./actions";
import { Avatar } from "./Avatar";
import { RequestRow } from "./RequestRow";

// ------------------------------------------------------------------ Kompaktes Panel (rechts neben jeder Seite)

export const FriendRow = memo(function FriendRow({ friend, compact }: { friend: Friend; compact?: boolean }) {
  const ptext = usePresenceText();
  const offline = friend.presence.status === "offline";
  return (
    <ContextMenu content={<FriendMenuItems friend={friend} />}>
      <button
        onClick={() => void startDm(friend.user.id)}
        className={cn(
          "group mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-ctl px-2 text-left transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]",
          compact ? "h-10" : "h-11",
          offline && "opacity-60 hover:opacity-100",
        )}
      >
        <Avatar user={friend.user} size={compact ? 26 : 28} presence={friend.presence} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-text">{friend.user.name}</span>
          <span className={cn("block truncate text-caption", isActive(friend) ? "text-brand" : "text-dim")}>
            {friend.user.statusText && offline ? friend.user.statusText : ptext(friend.presence)}
          </span>
        </span>
        <MessageSquare size={14} className="shrink-0 text-dim opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
      </button>
    </ContextMenu>
  );
});

/** Ruhige Gruppenüberschrift in Listen (Panel, Postfach). */
export function GroupLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-8 items-center justify-between px-3.5 pt-2", className)}>
      <span className="text-caption font-semibold text-dim">{children}</span>
      {right}
    </div>
  );
}

/** Kompakte Freundesliste für das rechte Panel (eingehende Anfragen, online, offline). */
export function FriendsTab({ compact }: { compact?: boolean }) {
  const t = useT();
  const friends = useFriends();
  const incoming = useSocial((s) => s.requests).filter((r) => r.direction === "incoming");
  const online = friends.filter((f) => f.presence.status !== "offline");
  const offline = friends.filter((f) => f.presence.status === "offline");
  return (
    <div className="scroll min-h-0 flex-1 pb-3">
      {incoming.length > 0 && (
        <>
          <GroupLabel>{t("social.req.title_in", { n: incoming.length })}</GroupLabel>
          {incoming.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </>
      )}
      <GroupLabel>{t("social.friends.online", { n: online.length })}</GroupLabel>
      {online.length === 0 && <p className="px-3.5 py-1.5 text-[12px] text-dim">{friends.length ? t("social.friends.none_online") : t("social.friends.empty")}</p>}
      {online.map((f) => (
        <FriendRow key={f.user.id} friend={f} compact={compact} />
      ))}
      {offline.length > 0 && (
        <>
          <GroupLabel>{t("social.friends.offline", { n: offline.length })}</GroupLabel>
          {offline.map((f) => (
            <FriendRow key={f.user.id} friend={f} compact={compact} />
          ))}
        </>
      )}
    </div>
  );
}
