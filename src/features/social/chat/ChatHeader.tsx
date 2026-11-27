import { Flag, LogOut, Mail, MoreHorizontal, Pencil, Play, UserPlus, Users } from "lucide-react";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, IconButton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Chat } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";
import { chatTitle, dmPartner } from "../hooks";
import { ActivityIcon, isPlaying, usePresenceParts } from "../presence";
import { errText, requireClient, useSocial } from "../service";
import { openAddMembers, openChatReport, openInviteAccept, openInviteFriends, openRenameGroup } from "../dialogStore";
import { AvatarStack } from "./AvatarStack";

export function ChatHeader({ chat, meId }: { chat: Chat; meId: string | undefined }) {
  const t = useT();
  const partner = dmPartner(chat, meId);
  const presence = useSocial((s) => (partner ? (s.friends[partner.id]?.presence ?? null) : undefined));
  const host = useSocial((s) => (partner ? Object.values(s.hosts).find((h) => h.host.id === partner.id && h.status === "online" && h.address) : undefined));
  const parts = usePresenceParts();
  const isOwner = chat.ownerId === meId;
  const p = presence ? parts(presence) : null;
  const others = chat.members.filter((m) => m.user.id !== meId).map((m) => m.user);
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line pl-5 pr-3">
      {partner ? (
        <Avatar user={partner} size={32} presence={presence} />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-card bg-surface2 text-muted">
          <Users size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-bold leading-tight text-text">{chatTitle(chat, meId)}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-tight">
          {partner ? (
            presence === undefined ? (
              <span className="text-dim">{t("social.chat.not_friend")}</span>
            ) : presence && isPlaying(presence) && p ? (
              <>
                <ActivityIcon activity={presence.activity} size={12} className="text-brand" />
                <span className="truncate text-muted">
                  {p.lead} <span className="font-medium text-text">{p.what}</span>
                  {p.detail && <span className="text-dim"> · {p.detail}</span>}
                </span>
              </>
            ) : (
              <span className="truncate text-dim">{p ? (presence?.status === "offline" && p.when ? p.when : p.what) : ""}</span>
            )
          ) : (
            <>
              <AvatarStack users={others} size={14} max={5} />
              <span className="truncate text-dim">{t("social.chat.members", { n: chat.members.length })}</span>
            </>
          )}
        </div>
      </div>
      {host && (
        <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ host })}>
          {t("social.accept.join")}
        </Button>
      )}
      <IconButton label={t("social.chat.invite")} tip variant="ghost" size="sm" onClick={() => openInviteFriends(partner ? { userIds: [partner.id] } : { chatId: chat.id })}>
        <Mail size={15} />
      </IconButton>
      <DropdownMenu
        align="end"
        trigger={
          <IconButton label={t("social.chat.more")} tip variant="ghost" size="sm">
            <MoreHorizontal size={16} />
          </IconButton>
        }
      >
        {chat.type === "group" && (
          <>
            <DropdownItem icon={<UserPlus size={14} />} onSelect={() => openAddMembers(chat.id)}>
              {t("social.group.add_members")}
            </DropdownItem>
            {isOwner && (
              <DropdownItem icon={<Pencil size={14} />} onSelect={() => openRenameGroup(chat.id, chat.name ?? "")}>
                {t("social.group.rename")}
              </DropdownItem>
            )}
          </>
        )}
        <DropdownItem icon={<Flag size={14} />} onSelect={() => openChatReport(chat.id)}>
          {t("tk.report.chat_action")}
        </DropdownItem>
        {chat.type === "group" && (
          <>
            <DropdownSeparator />
            <DropdownItem
              icon={<LogOut size={14} />}
              danger
              onSelect={async () => {
                try {
                  if (meId) await requireClient().chats.removeMember(chat.id, meId);
                } catch (e) {
                  toast.error(errText(e));
                }
              }}
            >
              {t("social.chat.leave")}
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
    </div>
  );
}
