// Startansicht der Freunde-Seite (kein Chat gewählt): eine Werkzeugleiste (Filter links, Aktionen rechts), darunter
// die Freundesliste (spielt gerade / online / offline) in kompakten Zeilen, daneben eigenes Profil (Status),
// laufende Server von Freunden und das Hosting-Kontingent.
import { useQuery } from "@tanstack/react-query";
import { Play, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, EmptyState, SearchInput, Select, SettingsCard, Skeleton, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import type { Friend, HostSession, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { Avatar, FriendListRow } from "./FriendsList";
import { useFriends } from "./hooks";
import { SocialActions, openPageDialog } from "./PageActions";
import { openInviteAccept } from "./dialogs";
import { errText, requireClient, useSocial, vqk } from "./service";

function Group({ title, count, children, tone }: { title: string; count: number; children: ReactNode; tone?: "brand" | "ok" }) {
  return (
    <section className="flex flex-col">
      <header className="flex h-8 items-center gap-2 px-3">
        {tone && <span className={cn("h-1.5 w-1.5 rounded-dot", tone === "brand" ? "bg-brand" : "bg-ok")} />}
        <h3 className="text-section text-muted">{title}</h3>
        <span className="text-caption tabular-nums text-dim">{count}</span>
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function NoFriends() {
  const t = useT();
  return (
    <EmptyState
      icon={<Users size={28} />}
      title={t("social.empty.title")}
      text={t("social.empty.text")}
      action={
        <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => openPageDialog("add")}>
          {t("social.action.add")}
        </Button>
      }
    />
  );
}

function FriendGroups({ friends, hosts, q }: { friends: Friend[]; hosts: Record<string, HostSession>; q: string }) {
  const t = useT();
  const list = q ? friends.filter((f) => f.user.name.toLowerCase().includes(q)) : friends;
  const playing = list.filter((f) => f.presence.status !== "offline" && (f.presence.activity?.type === "playing" || f.presence.activity?.type === "hosting"));
  const online = list.filter((f) => f.presence.status !== "offline" && !playing.includes(f));
  const offline = list.filter((f) => f.presence.status === "offline");
  const row = (f: Friend) => <FriendListRow key={f.user.id} friend={f} host={hosts[f.user.id]} />;
  if (q && !list.length) return <p className="px-3 py-2 text-[12.5px] text-dim">{t("social.add.none")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {playing.length > 0 && (
        <Group title={t("social.friends.playing")} count={playing.length} tone="brand">
          {playing.map(row)}
        </Group>
      )}
      {(online.length > 0 || !q) && (
        <Group title={t("social.friends.online_title")} count={online.length} tone="ok">
          {online.length ? online.map(row) : <p className="px-3 py-2 text-[12.5px] text-dim">{playing.length ? t("social.friends.rest_playing") : t("social.friends.none_online")}</p>}
        </Group>
      )}
      {offline.length > 0 && (
        <Group title={t("social.friends.offline_title")} count={offline.length}>
          {offline.map(row)}
        </Group>
      )}
    </div>
  );
}

function ProfileCard() {
  const t = useT();
  const me = useSocial((s) => s.me);
  if (!me) return null;
  const setStatus = async (s: PresenceStatusSetting) => {
    useSocial.setState({ me: { ...me, presenceStatus: s } });
    try {
      await requireClient().presence.set({ status: s });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const dot = { online: "bg-ok", away: "bg-warn", busy: "bg-danger", invisible: "bg-dim" }[me.presenceStatus] ?? "bg-ok";
  return (
    <SettingsCard title={t("social.profile.title")}>
      <div className="flex items-center gap-3 px-4 pb-2 pt-3">
        <span className="relative shrink-0">
          <Avatar user={me} size={36} />
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-dot border-2 border-bg", dot)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight text-text">{me.name}</div>
          <div className="truncate text-caption text-dim">{t("social.profile.vibe")}</div>
        </div>
      </div>
      <div className="px-4 pb-3">
        <Select<PresenceStatusSetting>
          size="sm"
          className="w-full"
          value={me.presenceStatus}
          onChange={setStatus}
          options={(["online", "away", "busy", "invisible"] as const).map((k) => ({ value: k, label: t(`social.status.${k}`) }))}
        />
      </div>
    </SettingsCard>
  );
}

function HostingCard() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), staleTime: 30_000 });
  const l = q.data;
  return (
    <SettingsCard title={t("social.hosting.title")}>
      <div className="px-4 py-3">
        {!l ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <>
            {!l.enabled && <p className="mb-2 text-[12px] text-warn">{t("social.hosting.disabled")}</p>}
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-muted">{t("social.hosting.active")}</span>
              <span className="tabular-nums text-text">
                {l.active} / {l.maxHosts}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-pill bg-surface3">
              <div className="h-full rounded-pill bg-brand" style={{ width: `${l.maxHosts ? Math.min(100, (l.active / l.maxHosts) * 100) : 0}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-dim">{l.maxPlayersPerHost ? t("social.hosting.players", { n: l.maxPlayersPerHost }) : t("social.hosting.players_any")}</p>
          </>
        )}
      </div>
    </SettingsCard>
  );
}

function HostsCard({ hosts }: { hosts: HostSession[] }) {
  const t = useT();
  if (!hosts.length) return null;
  return (
    <SettingsCard title={t("social.hosts.title")} right={<span className="mr-1 h-1.5 w-1.5 rounded-dot bg-ok" />}>
      {hosts.map((h) => (
        <div key={h.id} className="flex items-center gap-3 border-line px-4 py-2.5 [&+&]:border-t">
          <Avatar user={h.host} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight text-text">{t("social.hosts.hosting", { name: h.host.name })}</div>
            <div className="truncate text-caption text-dim">
              {h.mcVersion ?? "?"} · {t("social.hosts.players", { n: h.players.length })}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<Play size={12} />} onClick={() => openInviteAccept({ host: h })}>
            {t("social.accept.join")}
          </Button>
        </div>
      ))}
    </SettingsCard>
  );
}

export function Overview() {
  const t = useT();
  const vibe = useVibe();
  const hosts = useSocial((s) => s.hosts);
  const motd = useSocial((s) => s.motd);
  const friends = useFriends();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hostsByUser = useMemo(() => {
    const m: Record<string, HostSession> = {};
    for (const h of Object.values(hosts)) if (h.status === "online" && h.address) m[h.host.id] = h;
    return m;
  }, [hosts]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-6">
        {friends.length > 0 && (
          <SearchInput value={query} onChange={setQuery} placeholder={t("social.friends.filter")} aria-label={t("social.friends.filter")} className="w-[240px] min-w-[150px]" />
        )}
        <div className="flex-1" />
        <SocialActions showAdd={friends.length > 0} />
      </div>
      <div className="scroll min-h-0 flex-1">
        <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-6 px-6 pb-10 pt-1 min-[1240px]:grid-cols-[minmax(0,1fr)_280px]">
          <div className="-mx-3 min-w-0">
            {motd && <div className="mx-3 mb-4 rounded-card bg-warn/10 px-4 py-2.5 text-[13px] text-warn">{motd}</div>}
            {friends.length ? <FriendGroups friends={friends} hosts={hostsByUser} q={q} /> : <NoFriends />}
          </div>
          <aside className="flex flex-col gap-5">
            <HostsCard hosts={Object.values(hostsByUser)} />
            <ProfileCard />
            {vibe.hosting && <HostingCard />}
          </aside>
        </div>
      </div>
    </div>
  );
}
