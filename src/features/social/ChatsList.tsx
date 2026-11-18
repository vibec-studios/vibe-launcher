// Liste der Chats (DMs + Gruppen): kompakte Zeilen mit letzter Nachricht, Ungelesen-Zähler und Tippen-Anzeige;
// Aktionen (gelesen markieren, Gruppe verlassen) per Rechtsklick und im Chat-Kopf.
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
        aria-current={active ? "page" : undefined}
        className={cn(
          "mx-2 flex h-12 w-[calc(100%-16px)] items-center gap-2.5 rounded-ctl px-2 text-left transition-colors duration-100 data-[state=open]:bg-white/[.04]",
          active ? "bg-white/[.07]" : "hover:bg-white/[.04]",
        )}
      >
        {partner ? (
          <Avatar user={partner} size={30} presence={presence} />
        ) : (
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-card bg-surface2 text-muted">
            <Users size={14} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-tight text-text", chat.unreadCount ? "font-bold" : "font-semibold")}>
              {chatTitle(chat, meId)}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-dim">{shortTime(last?.createdAt, lang)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[12px] leading-snug", typing.length ? "text-brand" : chat.unreadCount ? "text-muted" : "text-dim")}>{preview}</span>
            {chat.unreadCount > 0 && (
              <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-pill bg-brand px-1 text-[10px] font-semibold tabular-nums leading-none text-[var(--ui-on-accent)]">
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
    <div className="scroll flex min-h-0 flex-1 flex-col gap-px py-1">

      {chats.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-dim">{t("social.chat.none")}</p>
      ) : (
        chats.map((c) => <ChatRow key={c.id} chat={c} active={c.id === activeId} />)
      )}
    </div>
  );
}
