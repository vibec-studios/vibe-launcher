// Profil eines Freundes als Popover (wie bei Discord): Skin in 3D (Ganzkörper, ruhige Idle-Animation), Name,
// Status mit Aktivität, Statustext, „Freunde seit …“, laufender Host mit Mitspielern und die Hauptaktionen.
import * as Popover from "@radix-ui/react-popover";
import { CalendarHeart, Ellipsis, MessageSquare, Play, Send } from "lucide-react";
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { Button, DropdownMenu, IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatDate } from "@/lib/format";
import type { Friend, HostSession } from "@/lib/vibe-sdk";
import { ActionItems, Avatar, UserBadge, friendActions, skinUrlOf, startDm } from "./FriendsList";
import { ActivityIcon, PresenceDot, isPlaying, usePresenceParts } from "./presence";
import { openInviteAccept, openInviteFriends } from "./dialogs";
import { useSocial } from "./service";

const SkinViewer3D = lazy(() => import("@/features/skins/SkinViewer3D"));

/** Fängt WebGL-/Texturfehler ab und zeigt dann den großen Kopf. */
class ViewerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ProfilePopover({ friend, host, children }: { friend: Friend; host?: HostSession; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          alignOffset={56}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] w-[300px] overflow-hidden rounded-card bg-overlay shadow-e3 outline-none data-[state=open]:animate-pop-in"
        >
          {open && <ProfileCard friend={friend} host={host} close={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ProfileCard({ friend, host, close }: { friend: Friend; host?: HostSession; close: () => void }) {
  const t = useT();
  const friends = useSocial((s) => s.friends);
  const parts = usePresenceParts();
  const u = friend.user;
  const skin = skinUrlOf(u);
  const p = parts(friend.presence);
  const playing = isPlaying(friend.presence);
  const offline = friend.presence.status === "offline";
  const bigHead = (
    <div className="grid h-full place-items-center">
      <Avatar user={u} size={96} />
    </div>
  );
  return (
    <div className="flex flex-col">
      <div className="relative h-[210px] bg-surface2">
        {skin ? (
          <ViewerBoundary fallback={bigHead}>
            <Suspense fallback={bigHead}>
              <div className="absolute inset-0">
                <SkinViewer3D skin={skin} variant={u.skin?.model === "slim" ? "slim" : "classic"} cape={u.skin?.capeUrl ? u.skin.capeUrl.replace(/^http:\/\//, "https://") : null} animation="idle" />
              </div>
            </Suspense>
          </ViewerBoundary>
        ) : (
          bigHead
        )}
      </div>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="selectable truncate text-[17px] font-bold leading-tight tracking-[-0.01em] text-text">{u.name}</span>
            <UserBadge badge={u.badge} />
          </div>
          <div className="mt-1.5 flex min-w-0 items-start gap-2 text-[12.5px] leading-snug">
            <PresenceDot presence={friend.presence} ring="var(--overlay)" size={9} className="mt-[4px]" />
            <span className="min-w-0">
              {playing ? (
                <>
                  <span className="text-muted">{p.lead} </span>
                  <span className="font-semibold text-text">{p.what}</span>
                  {(p.detail || p.when) && <span className="block text-dim">{[p.detail, p.when].filter(Boolean).join(" · ")}</span>}
                </>
              ) : (
                <span className={offline ? "text-dim" : "text-muted"}>{offline && p.when ? p.when : p.what}</span>
              )}
            </span>
          </div>
          {u.statusText && <p className="selectable mt-2 rounded-ctl bg-white/[.04] px-2.5 py-1.5 text-[12.5px] leading-snug text-muted">„{u.statusText}“</p>}
        </div>

        {host && (
          <div className="rounded-ctl bg-white/[.04] p-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              <ActivityIcon activity={{ type: "hosting" }} className="text-brand" />
              <span className="min-w-0 flex-1 truncate font-semibold text-text">{friend.presence.activity?.world ?? host.mcVersion ?? "Server"}</span>
              <span className="shrink-0 tabular-nums text-dim">
                {host.players.length}
                {host.maxPlayers ? `/${host.maxPlayers}` : ""}
              </span>
            </div>
            {host.players.length > 0 && (
              <div className="mt-2 flex items-center -space-x-1">
                {host.players.slice(0, 8).map((pl) => (
                  <span key={pl.name} title={pl.name} className="rounded-xs ring-2 ring-[var(--overlay)]">
                    <Avatar user={(pl.uuid && friends[pl.uuid]?.user) || { id: pl.uuid ?? pl.name, name: pl.name }} size={20} />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[12px] text-dim">
          <CalendarHeart size={13} />
          {t("social.profile.since", { date: formatDate(friend.since) })}
        </div>

        <div className="flex items-center gap-1.5">
          {host ? (
            <Button
              size="sm"
              variant="primary"
              icon={<Play size={13} />}
              className="flex-1"
              onClick={() => {
                close();
                openInviteAccept({ host });
              }}
            >
              {t("social.accept.join")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={host ? "ghost" : "primary"}
            icon={<MessageSquare size={13} />}
            className={cn(!host && "flex-1")}
            onClick={() => {
              close();
              void startDm(u.id);
            }}
          >
            {t("social.friend.message")}
          </Button>
          {!host && (
            <IconButton
              label={t("social.friend.invite")}
              tip
              tipSide="top"
              size="sm"
              onClick={() => {
                close();
                openInviteFriends({ userIds: [u.id] });
              }}
            >
              <Send size={14} />
            </IconButton>
          )}
          <DropdownMenu
            align="end"
            trigger={
              <IconButton label={t("social.chat.more")} size="sm">
                <Ellipsis size={15} />
              </IconButton>
            }
          >
            <ActionItems actions={friendActions(friend, host).filter((a) => a.key !== "msg" && a.key !== "join")} kind="dropdown" />
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
