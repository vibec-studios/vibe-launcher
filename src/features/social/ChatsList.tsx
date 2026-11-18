// Liste der Chats (DMs + Gruppen) mit letzter Nachricht, Ungelesen-Zähler und Tippen-Anzeige.
import { CheckCheck, LogOut, Users } from "lucide-react";
import { memo } from "react";
import { ContextItem, ContextMenu, ContextSeparator, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Chat } from "@/lib/vibe-sdk";
import { Avatar } from "./FriendsList";
import { chatTitle, dmPartner, useChatsSorted, useTypingUsers } from "./hooks";
import { errText, markRead, openSocial, requireClient, useSocial } from "./service";

function shortTime(iso: string | undefined, lang: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit" });
}

const ChatRow = memo(function ChatRow({ chat, active }: { chat: Chat; active: boolean }) {
  const t = useT();
  const meId = useSocial((s) => s.me?.id);
  const partner = dmPartner(chat, meId);
  const presence = useSocial((s) => (partner ? (s.friends[partner.id]?.presence ?? null) : undefined));
  const typing = useTypingUsers(chat.id);
  const lang = document.documentElement.lang || "de";
  const last = chat.lastMessage;
  const preview = typing.length
    ? t("social.chat.typing_short")
    : !last
      ? t("social.chat.empty_preview")
      : last.deleted
        ? t("social.chat.deleted")
        : last.kind === "invite"
          ? `✉ ${last.invite?.title ?? ""}`
          : last.kind === "system"
            ? t("social.chat.system_preview")
            : `${last.authorId === meId ? t("social.chat.you") + ": " : ""}${last.content}`;
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<CheckCheck size={14} />} disabled={!chat.unreadCount} onSelect={() => markRead(chat.id)}>
            {t("social.chat.mark_read")}
          </ContextItem>
          {chat.type === "group" && (
            <>
              <ContextSeparator />
              <ContextItem
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
              </ContextItem>
            </>
          )}
        </>
      }
    >
      <button
        onClick={() => openSocial(chat.id)}
        className={cn(
          "relative flex h-14 w-full items-center gap-2.5 px-3 text-left transition-colors duration-100",
          active ? "bg-surface3" : "hover:bg-white/[.04]",
        )}
      >
        {active && <span className="absolute bottom-2 left-0 top-2 w-[3px] bg-brand" />}
        {partner ? (
          <Avatar user={partner} size={32} presence={presence} />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-line2 bg-surface2 text-muted">
            <Users size={15} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", chat.unreadCount ? "font-bold text-white" : "font-semibold text-text")}>{chatTitle(chat, meId)}</span>
            <span className="shrink-0 font-mono text-[10px] text-dim">{shortTime(last?.createdAt, lang)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[12px]", typing.length ? "text-brand" : chat.unreadCount ? "text-text" : "text-dim")}>{preview}</span>
            {chat.unreadCount > 0 && (
              <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center bg-brand px-1 font-mono text-[10px] font-bold text-white">
                {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
              </span>
            )}
          </span>
        </span>
      </button>
    </ContextMenu>
  );
});

export function ChatsList({ activeId }: { activeId: string | null }) {
  const t = useT();
  const chats = useChatsSorted();
  return (
    <div className="scroll min-h-0 flex-1 py-1">
      {chats.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-dim">{t("social.chat.none")}</p>
      ) : (
        chats.map((c) => <ChatRow key={c.id} chat={c} active={c.id === activeId} />)
      )}
    </div>
  );
}
