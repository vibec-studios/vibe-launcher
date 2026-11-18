// Seite „Freunde“ (/social): links Chats bzw. Freunde, rechts der gewählte Chat oder die Übersicht.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { MessageSquarePlus, Users } from "lucide-react";
import { useState } from "react";
import { IconButton, Segmented, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { ChatsList } from "./ChatsList";
import { ChatView } from "./ChatView";
import { FriendsTab } from "./FriendsList";
import { Gate } from "./Gate";
import { Overview } from "./Overview";
import { openNewGroup } from "./dialogs";
import { useSocial } from "./service";

const route = getRouteApi("/social");

export function SocialPage() {
  const t = useT();
  const nav = useNavigate();
  const { chat } = route.useSearch();
  const [tab, setTab] = useState<"chats" | "friends">("chats");
  const incoming = useSocial((s) => s.requests.filter((r) => r.direction === "incoming").length);
  const unread = useSocial((s) => Object.values(s.chats).reduce((n, c) => n + (c.unreadCount ? 1 : 0), 0));
  return (
    <div className="flex h-full flex-col">
      <Gate>
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-black/20">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
              <Segmented
                value={tab}
                onChange={setTab}
                className="flex-1 [&>button]:flex-1"
                items={[
                  { value: "chats", label: unread ? `${t("social.tab.chats")} · ${unread}` : t("social.tab.chats") },
                  { value: "friends", label: incoming ? `${t("social.tab.friends")} · ${incoming}` : t("social.tab.friends") },
                ]}
              />
              <Tooltip content={t("social.group.new")}>
                <IconButton label={t("social.group.new")} size="sm" onClick={openNewGroup}>
                  <MessageSquarePlus size={15} />
                </IconButton>
              </Tooltip>
            </div>
            {tab === "chats" ? <ChatsList activeId={chat ?? null} /> : <FriendsTab />}
            <button
              onClick={() => nav({ to: "/social", search: {} })}
              className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3 text-[12px] text-muted hover:bg-white/[.03] hover:text-white"
            >
              <Users size={14} />
              {t("social.overview")}
            </button>
          </aside>
          <section className="min-w-0 flex-1">{chat ? <ChatView chatId={chat} /> : <Overview />}</section>
        </div>
      </Gate>
    </div>
  );
}
