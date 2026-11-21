// Seite „Freunde“ (/social): links eine schmale Spalte (Freunde-Übersicht, Postfach, Chats), rechts die Übersicht
// mit eigener Werkzeugleiste oder der gewählte Chat. Der Seitentitel steht in der Titelleiste.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { MessageSquarePlus, Users } from "lucide-react";
import { IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { ChatsList } from "./ChatsList";
import { ChatView } from "./ChatView";
import { Gate } from "./Gate";
import { Overview } from "./Overview";
import { InboxButton, PageDialogs } from "./PageActions";
import { openNewGroup } from "./dialogStore";
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
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[264px] shrink-0 flex-col border-r border-line max-[900px]:w-[228px]">
            <div className="flex h-9 shrink-0 items-center gap-1 px-2 mb-2 mt-4">
              <button
                onClick={() => nav({ to: "/social", search: {} })}
                aria-current={!chat ? "page" : undefined}
                title={me ? t("social.signed_in_as", { name: me.name }) : undefined}
                className={cn(
                  "flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-ctl px-2.5 text-left text-[13px] font-semibold transition-colors duration-100",
                  !chat ? "bg-white/[.07] text-text" : "text-muted hover:bg-white/[.04] hover:text-text",
                )}
              >
                <Users size={15} className={!chat ? "text-brand" : "text-dim"} />
                <span className="flex-1 truncate">{t("social.tab.friends")}</span>
                <span className="flex items-center gap-1.5 text-caption font-normal tabular-nums text-dim">
                  <span className="h-1.5 w-1.5 rounded-dot bg-ok" />
                  {online}
                </span>
              </button>
              <InboxButton />
            </div>
            <div className="flex h-8 shrink-0 items-center justify-between pl-4 pr-2">
              <span className="text-caption font-semibold text-dim">
                {t("social.tab.chats")}
                {chatCount > 0 && <span className="ml-1.5 font-normal tabular-nums">{chatCount}</span>}
              </span>
              <IconButton label={t("social.group.new")} tip variant="ghost" size="sm" onClick={openNewGroup}>
                <MessageSquarePlus size={15} />
              </IconButton>
            </div>
            {chatCount ? (
              <ChatsList activeId={chat ?? null} />
            ) : (
              <div className="px-4 py-6">
                <p className="text-[12.5px] font-semibold text-muted">{t("social.chat.none")}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-dim">{t("social.chat.none_hint")}</p>
              </div>
            )}
          </aside>
          <section className="min-w-0 flex-1">{chat ? <ChatView chatId={chat} /> : <Overview />}</section>
        </div>
        <PageDialogs />
      </Gate>
    </div>
  );
}
