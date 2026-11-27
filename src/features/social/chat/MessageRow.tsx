import { copyText as writeText } from "@/components/content/util";
import { ChatShot } from "@/features/shotshare/ChatShot";
import { withoutShotLink } from "@/features/shotshare/api";
import { CheckCheck, Clipboard, Flag, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { memo } from "react";
import { ContextMenu, DropdownMenu, IconButton, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Message, PublicUser } from "@/lib/vibe-sdk";
import { Avatar, startDm } from "../FriendsList";
import { errText, requireClient } from "../service";
import { openChatReport } from "../dialogStore";
import { EditBox } from "./EditBox";
import { InviteCardRow } from "./InviteCardRow";
import { MsgItems, type MsgAction } from "./MsgItems";
import { SystemLine } from "./SystemLine";
import { EMOJI_ONLY, MINE_BG, timeOf } from "./utils";

/** Nachricht in einer Gruppe: andere links mit Kopf (nur erste der Gruppe), eigene rechts in der Akzentfarbe.
 *  Uhrzeit an der ersten Nachricht, bei Folgenachrichten beim Hover. Aktionen per Rechtsklick und ⋯. */
export const MessageRow = memo(function MessageRow({
  m,
  head,
  tail,
  author,
  mine,
  canModerate,
  editing,
  setEditing,
  read,
}: {
  m: Message;
  head: boolean;
  tail: boolean;
  author: PublicUser | undefined;
  mine: boolean;
  canModerate: boolean;
  editing: boolean;
  setEditing: (id: string | null) => void;
  read: { all: boolean; n: number; dm: boolean } | null;
}) {
  const t = useT();
  const pending = m.id.startsWith("tmp-");
  if (m.kind === "system") return <SystemLine m={m} />;
  if (m.kind === "invite") return <InviteCardRow m={m} mine={mine} author={author} />;

  const jumbo = !m.deleted && EMOJI_ONLY.test(m.content.trim());
  const actions: MsgAction[] = [
    {
      key: "copy",
      icon: <Clipboard size={14} />,
      label: t("social.msg.copy"),
      disabled: m.deleted,
      onSelect: () => void writeText(m.content).then(() => toast.success(t("social.copied"))),
    },
  ];
  if (mine && !m.deleted && !pending) actions.push({ key: "edit", icon: <Pencil size={14} />, label: t("social.msg.edit"), onSelect: () => setEditing(m.id) });
  if (!mine && !m.deleted && !pending)
    actions.push({ key: "report", sep: true, icon: <Flag size={14} />, label: t("tk.report.action"), onSelect: () => openChatReport(m.chatId, [m.id]) });
  if ((mine || canModerate) && !m.deleted && !pending)
    actions.push({
      key: "delete",
      sep: true,
      danger: true,
      icon: <Trash2 size={14} />,
      label: t("social.msg.delete"),
      onSelect: () => void requireClient().chats.delete(m.chatId, m.id).catch((e) => toast.error(errText(e))),
    });

  // Ecken innerhalb einer Gruppe enger (nur wirksam bei runden Ecken)
  const shape = mine
    ? cn(!head && "rounded-tr-xs", !tail && "rounded-br-xs")
    : cn(!head && "rounded-tl-xs", !tail && "rounded-bl-xs");

  return (
    <ContextMenu content={<MsgItems actions={actions} kind="context" />}>
      <div className={cn("group relative flex gap-3 px-5", mine && "flex-row-reverse", head ? "pt-3" : "pt-[3px]", pending && "opacity-60")}>
        {!mine && (
          <div className="w-8 shrink-0">
            {head && author ? (
              <button onClick={() => void startDm(author.id)} className="block transition-transform duration-100 hover:-translate-y-px" aria-label={author.name}>
                <Avatar user={author} size={32} />
              </button>
            ) : (
              <span className="block pt-[7px] text-right text-[10px] tabular-nums text-dim opacity-0 transition-opacity group-hover:opacity-100">{timeOf(m.createdAt)}</span>
            )}
          </div>
        )}
        <div className={cn("flex min-w-0 flex-col", mine ? "items-end" : "items-start", editing ? "w-full max-w-[640px]" : "max-w-[min(620px,76%)]")}>
          {head && (
            <div className={cn("mb-1 flex items-baseline gap-2 px-0.5", mine && "flex-row-reverse")}>
              {!mine && <span className="text-[13px] font-semibold text-text">{author?.name ?? t("social.msg.unknown")}</span>}
              <span className="text-[11px] tabular-nums text-dim">{timeOf(m.createdAt)}</span>
            </div>
          )}
          {editing ? (
            <EditBox m={m} done={() => setEditing(null)} />
          ) : (
            <div className={cn("flex min-w-0 max-w-full items-center gap-1", mine && "flex-row-reverse")}>
              {m.deleted ? (
                <p className="rounded-card border border-dashed border-line2 px-3 py-1.5 text-[13px] italic text-dim">{t("social.chat.deleted")}</p>
              ) : jumbo ? (
                <p title={timeOf(m.createdAt)} className="selectable px-0.5 text-[34px] leading-[1.15]">
                  {m.content.trim()}
                </p>
              ) : (
                <p
                  title={timeOf(m.createdAt)}
                  className={cn("selectable min-w-0 whitespace-pre-wrap break-words rounded-card px-3.5 py-2 text-[13.5px] leading-[1.45] text-text", mine ? MINE_BG : "bg-surface2", shape)}
                >
                  {withoutShotLink(m.content) || m.content}
                  {m.editedAt && <span className="ml-1.5 text-[10.5px] text-dim">{t("social.msg.edited")}</span>}
                </p>
              )}
              {!m.deleted && (
                <DropdownMenu
                  align={mine ? "end" : "start"}
                  trigger={
                    <IconButton
                      label={t("social.chat.more")}
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal size={14} />
                    </IconButton>
                  }
                >
                  <MsgItems actions={actions} kind="dropdown" />
                </DropdownMenu>
              )}
            </div>
          )}
          {!editing && !m.deleted && <ChatShot content={m.content} mine={mine} />}
          {read && (
            <div className="mt-1 flex items-center gap-1 px-0.5 text-[11px] text-dim animate-fade-in">
              {(read.dm ? read.all : read.n > 0) && <CheckCheck size={12} className="text-brand" />}
              {read.dm ? (read.all ? t("social.msg.read") : t("social.msg.sent")) : read.n ? t("social.msg.read_by", { n: read.n }) : t("social.msg.sent")}
            </div>
          )}
        </div>
      </div>
    </ContextMenu>
  );
});
