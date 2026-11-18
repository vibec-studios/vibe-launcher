// Seite „Freunde“ (/social): oben Titel + Aktionen (Postfach, Freund hinzufügen, Modpack teilen/importieren),
// links „Freunde“ und die Chats, rechts die Freundesliste oder der gewählte Chat.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { MessageSquarePlus, MessagesSquare, Users } from "lucide-react";
import { IconButton, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { ChatsList } from "./ChatsList";
import { ChatView } from "./ChatView";
import { Gate } from "./Gate";
import { Overview } from "./Overview";
import { SocialActions } from "./PageActions";
import { openNewGroup } from "./dialogs";
import { useSocial } from "./service";

const route = getRouteApi("/social");

export function SocialPage() {
  const t = useT();
  const nav = useNavigate();
  const { chat } = route.useSearch();
  const me = useSocial((s) => s.me);
  const online = useSocial((s) => Object.values(s.friends).filter((f) => f.presence.status !== "offline").length);
  const chatCount = useSocial((s) => Object.keys(s.chats).length);
  return (
    <div className="flex h-full flex-col">
      <Gate>
        <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line px-5">
          <div className="min-w-0 flex-1">
            <h1 className="display text-[20px] leading-none text-white">{t("social.title")}</h1>
            {me && <p className="mt-1.5 truncate text-[12px] text-muted">{t("social.signed_in_as", { name: me.name })}</p>}
          </div>
          <SocialActions />
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-black/20 max-[900px]:w-[232px]">
            <div className="p-2">
              <button
                onClick={() => nav({ to: "/social", search: {} })}
                className={cn(
                  "relative flex h-11 w-full items-center gap-3 px-3 text-left text-[13.5px] font-semibold transition-colors duration-100",
                  !chat ? "bg-surface3 text-white" : "text-muted hover:bg-white/[.04] hover:text-white",
                )}
              >
                {!chat && <span className="absolute bottom-2 left-0 top-2 w-[3px] bg-brand" />}
                <Users size={16} className={!chat ? "text-white" : "text-dim"} />
                <span className="flex-1">{t("social.tab.friends")}</span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] font-normal text-dim">
                  <span className="h-1.5 w-1.5 bg-ok" />
                  {online}
                </span>
              </button>
            </div>
            <div className="flex h-9 shrink-0 items-center justify-between border-t border-line pl-4 pr-2 pt-1">
              <span className="eyebrow flex items-center gap-2">
                {t("social.tab.chats")}
                {chatCount > 0 && <span className="font-mono text-[11px] normal-case tracking-normal text-dim">{chatCount}</span>}
              </span>
              <Tooltip content={t("social.group.new")}>
                <IconButton label={t("social.group.new")} size="sm" className="border-transparent bg-transparent" onClick={openNewGroup}>
                  <MessageSquarePlus size={15} />
                </IconButton>
              </Tooltip>
            </div>
            {chatCount ? (
              <ChatsList activeId={chat ?? null} />
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <MessagesSquare size={20} className="text-dim" />
                <p className="text-[12.5px] font-semibold text-text">{t("social.chat.none")}</p>
                <p className="text-[12px] leading-relaxed text-dim">{t("social.chat.none_hint")}</p>
              </div>
            )}
          </aside>
          <section className="min-w-0 flex-1">{chat ? <ChatView chatId={chat} /> : <Overview />}</section>
        </div>
      </Gate>
    </div>
  );
}
