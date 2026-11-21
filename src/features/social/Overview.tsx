// Startansicht der Freunde-Seite (kein Chat gewählt): Werkzeugleiste (Filter links, Aktionen rechts); darunter
// prominent die Welten/Server, die Freunde gerade hosten („Beitreten“), offene Anfragen und Einladungen, dann die
// Freundesliste (spielt gerade / online / offline). Rechts das eigene Profil (Skin, Status, Statustext) und das
// Hosting-Kontingent.
import { MyHostsSection } from "@/features/hostpanel/MyHosts";
import { InviteFriendsCard } from "@/features/accessinvite/InviteFriends";
import { Megaphone } from "lucide-react";
import { useMemo, useState } from "react";
import { PageToolbar, SearchInput, cn, pageWrap } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import type { HostSession } from "@/lib/vibe-sdk";
import { useFriends } from "./hooks";
import { SocialActions } from "./PageActions";
import { FeedCard } from "@/features/feed/FeedCard";
import { useSocial } from "./service";
import { FriendGroups, NoFriends } from "./overview/FriendGroups";
import { InviteCard, RequestCard } from "./overview/FreshCards";
import { HostCard } from "./overview/HostCard";
import { HostingCard } from "./overview/HostingCard";
import { ProfileCard } from "./overview/ProfileCard";

export { SealArt } from "./overview/SealArt";

export function Overview() {
  const t = useT();
  const vibe = useVibe();
  const hosts = useSocial((s) => s.hosts);
  const motd = useSocial((s) => s.motd);
  const requests = useSocial((s) => s.requests);
  const invites = useSocial((s) => s.invites);
  const friendsMap = useSocial((s) => s.friends);
  const friends = useFriends();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hostsByUser = useMemo(() => {
    const m: Record<string, HostSession> = {};
    for (const h of Object.values(hosts)) if (h.status === "online" && h.address) m[h.host.id] = h;
    return m;
  }, [hosts]);
  const hostList = Object.values(hostsByUser);
  const incoming = requests.filter((r) => r.direction === "incoming");
  const fresh = invites.length + incoming.length > 0;
  return (
    <div className="flex h-full flex-col">
      <div className={cn(pageWrap, "shrink-0 pb-4 pt-4")}>
        <PageToolbar actions={<SocialActions showAdd />}>
          {friends.length > 0 && (
            <SearchInput value={query} onChange={setQuery} placeholder={t("social.friends.filter")} aria-label={t("social.friends.filter")} className="min-w-[160px] max-w-[320px] flex-1 basis-[240px]" />
          )}
        </PageToolbar>
      </div>
      <div className="scroll min-h-0 flex-1">
        <div className={cn(pageWrap, "grid grid-cols-1 gap-8 pb-12 pt-1 min-[1180px]:grid-cols-[minmax(0,1fr)_288px] min-[1800px]:grid-cols-[minmax(0,1fr)_320px]")}>
          <div className="flex min-w-0 flex-col gap-7">
            {motd && (
              // Ankündigung von Vibe: ruhig wie auf der Startseite, nicht als Warnung
              <div className="flex items-start gap-3 rounded-card bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">
                <Megaphone size={15} className="mt-0.5 shrink-0 text-brand" />
                <p className="min-w-0 flex-1">{motd}</p>
              </div>
            )}
            {!q && <MyHostsSection />}
            {hostList.length > 0 && !q && (
              <section>
                <h2 className="mb-2.5 text-[15px] font-bold tracking-[-0.01em] text-text">{t("social.hosts.title")}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                  {hostList.map((h) => (
                    <HostCard key={h.id} h={h} friend={friendsMap[h.host.id]} />
                  ))}
                </div>
              </section>
            )}
            {fresh && !q && (
              <section>
                <h2 className="mb-2.5 text-[15px] font-bold tracking-[-0.01em] text-text">{t("social.fresh.title")}</h2>
                <div className="flex flex-col gap-2">
                  {invites.map((inv) => (
                    <InviteCard key={inv.id} inv={inv} />
                  ))}
                  {incoming.map((r) => (
                    <RequestCard key={r.id} r={r} />
                  ))}
                </div>
              </section>
            )}
            <div className="-mx-3 min-w-0">{friends.length ? <FriendGroups friends={friends} hosts={hostsByUser} q={q} /> : <NoFriends />}</div>
          </div>
          <aside className="flex flex-col gap-3">
            <ProfileCard />
            <InviteFriendsCard />
            {vibe.hosting && <HostingCard />}
            <FeedCard />
          </aside>
        </div>
      </div>
    </div>
  );
}
