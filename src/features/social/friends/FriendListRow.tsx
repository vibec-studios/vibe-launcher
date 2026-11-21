import { Ellipsis, MessageSquare, Play, Send } from "lucide-react";
import { memo } from "react";
import { Button, ContextMenu, DropdownMenu, IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Friend, HostSession } from "@/lib/vibe-sdk";
import { ActivityIcon, usePresenceParts } from "../presence";
import { ProfilePopover } from "../ProfilePopover";
import { openInviteAccept, openInviteFriends } from "../dialogStore";
import { ActionItems, friendActions, isActive, startDm } from "./actions";
import { Avatar } from "./Avatar";
import { UserBadge } from "./UserBadge";

// ------------------------------------------------------------------ Zeile auf der Freunde-Seite

/** Zeile wie in Discord/Steam: Skin-Kopf mit Status, Name, darunter die Aktivität mit Symbol („spielt X · 1.21.4 ·
 *  seit 42 Min.“) bzw. „zuletzt online …“. Klick öffnet das Profil, Doppelklick den Chat. Sichtbar höchstens
 *  „Beitreten“ (wenn gehostet), beim Hover Nachricht/Einladen; alles Weitere im ⋯-Menü und per Rechtsklick. */
export const FriendListRow = memo(function FriendListRow({ friend, host }: { friend: Friend; host?: HostSession }) {
  const t = useT();
  const parts = usePresenceParts();
  const offline = friend.presence.status === "offline";
  const active = isActive(friend);
  const actions = friendActions(friend, host);
  const p = parts(friend.presence);
  return (
    <ContextMenu content={<ActionItems actions={actions} kind="context" />}>
      <div className="group relative flex h-[60px] items-center gap-3.5 rounded-card px-3 transition-colors duration-100 hover:bg-surface data-[state=open]:bg-surface has-[[aria-expanded=true]]:bg-surface">
        <ProfilePopover friend={friend} host={host}>
          <button
            className="absolute inset-0 rounded-card outline-none focus-visible:bg-surface"
            aria-label={t("social.profile.open", { name: friend.user.name })}
            onDoubleClick={() => void startDm(friend.user.id)}
          />
        </ProfilePopover>
        <span className={cn("pointer-events-none relative", offline && "opacity-50 grayscale-[.6] transition-[opacity,filter] duration-150 group-hover:opacity-90 group-hover:grayscale-0")}>
          <Avatar user={friend.user} size={38} presence={friend.presence} />
        </span>
        <div className="pointer-events-none relative min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-[14px] font-semibold leading-tight", offline ? "text-muted" : "text-text")}>{friend.user.name}</span>
            {friend.user.badge !== "user" && <UserBadge badge={friend.user.badge} />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] leading-tight">
            {active ? (
              <>
                <ActivityIcon activity={friend.presence.activity} className="text-brand" />
                <span className="truncate">
                  <span className="text-muted">{p.lead} </span>
                  <span className="font-medium text-text">{p.what}</span>
                  {p.detail && <span className="text-dim"> · {p.detail}</span>}
                  {p.when && <span className="text-dim"> · {p.when}</span>}
                </span>
              </>
            ) : (
              <span className="truncate">
                <span className={offline ? "text-dim" : "text-muted"}>{offline && p.when ? p.when : p.what}</span>
                {friend.user.statusText && <span className="text-dim"> · „{friend.user.statusText}“</span>}
              </span>
            )}
          </div>
        </div>
        <div className="relative flex shrink-0 items-center gap-1">
          <IconButton
            label={t("social.friend.message")}
            tip
            variant="ghost"
            size="sm"
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => void startDm(friend.user.id)}
          >
            <MessageSquare size={15} />
          </IconButton>
          {!host && !offline && (
            <IconButton
              label={t("social.friend.invite")}
              tip
              variant="ghost"
              size="sm"
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => openInviteFriends({ userIds: [friend.user.id] })}
            >
              <Send size={14} />
            </IconButton>
          )}
          <DropdownMenu
            align="end"
            trigger={
              <IconButton
                label={t("social.chat.more")}
                variant="ghost"
                size="sm"
                className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <Ellipsis size={15} />
              </IconButton>
            }
          >
            <ActionItems actions={actions} kind="dropdown" />
          </DropdownMenu>
          {/* Immer sichtbar und ganz rechts – die Hover-Symbole davor schieben ihn nicht nach innen */}
          {host ? (
            <Button size="sm" variant="ghost" className="ml-1" icon={<Play size={13} />} onClick={() => openInviteAccept({ host })}>
              {t("social.accept.join")}
            </Button>
          ) : null}
        </div>
      </div>
    </ContextMenu>
  );
});
