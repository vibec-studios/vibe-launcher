// Startansicht der Freunde-Seite (kein Chat gewählt): Freundesliste (spielt gerade / online / offline) mit
// Hover-/Kontextaktionen, daneben eigenes Profil (Status) und Hosting-Kontingent.
import { useQuery } from "@tanstack/react-query";
import { Play, Radio, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, SearchInput, Select, Skeleton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import type { Friend, HostSession, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { Avatar, FriendListRow } from "./FriendsList";
import { useFriends } from "./hooks";
import { openPageDialog } from "./PageActions";
import { openInviteAccept } from "./dialogs";
import { errText, requireClient, useSocial, vqk } from "./service";

function Group({ title, count, children, tone }: { title: string; count: number; children: ReactNode; tone?: "brand" | "ok" }) {
  return (
    <section>
      <header className="flex h-9 items-center gap-2 px-4">
        {tone && <span className={tone === "brand" ? "h-1.5 w-1.5 bg-brand" : "h-1.5 w-1.5 bg-ok"} />}
        <span className="eyebrow">{title}</span>
        <span className="font-mono text-[11px] text-dim">{count}</span>
      </header>
      <div className="border-y border-line bg-surface/50">{children}</div>
    </section>
  );
}

function NoFriends() {
  const t = useT();
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="relative mb-5 grid h-20 w-20 place-items-center border border-line2 bg-surface2">
        <span className="absolute -inset-3 -z-10 bg-brand/10 blur-2xl" />
        <Users size={30} className="text-muted" />
        <span className="absolute -bottom-2 -right-2 grid h-8 w-8 place-items-center border border-black bg-brand text-white">
          <UserPlus size={15} />
        </span>
      </div>
      <h2 className="display text-[18px] text-white">{t("social.empty.title")}</h2>
      <p className="mt-2 max-w-[380px] text-[13px] leading-relaxed text-muted">{t("social.empty.text")}</p>
      <Button variant="primary" className="mt-5" icon={<UserPlus size={14} />} onClick={() => openPageDialog("add")}>
        {t("social.action.add")}
      </Button>
    </div>
  );
}

function FriendGroups({ friends, hosts }: { friends: Friend[]; hosts: Record<string, HostSession> }) {
  const t = useT();
  const [q, setQ] = useState("");
  const list = q.trim() ? friends.filter((f) => f.user.name.toLowerCase().includes(q.trim().toLowerCase())) : friends;
  const playing = list.filter((f) => f.presence.status !== "offline" && (f.presence.activity?.type === "playing" || f.presence.activity?.type === "hosting"));
  const online = list.filter((f) => f.presence.status !== "offline" && !playing.includes(f));
  const offline = list.filter((f) => f.presence.status === "offline");
  const row = (f: Friend) => <FriendListRow key={f.user.id} friend={f} host={hosts[f.user.id]} />;
  return (
    <div className="flex flex-col gap-5">
      {friends.length > 8 && (
        <div className="px-4">
          <SearchInput value={q} onChange={setQ} placeholder={t("social.friends.filter")} aria-label={t("social.friends.filter")} className="max-w-[320px]" />
        </div>
      )}
      {playing.length > 0 && (
        <Group title={t("social.friends.playing")} count={playing.length} tone="brand">
          {playing.map(row)}
        </Group>
      )}
      <Group title={t("social.friends.online_title")} count={online.length} tone="ok">
        {online.length ? online.map(row) : <p className="px-4 py-4 text-[12.5px] text-dim">{playing.length ? t("social.friends.rest_playing") : t("social.friends.none_online")}</p>}
      </Group>
      {offline.length > 0 && (
        <Group title={t("social.friends.offline_title")} count={offline.length}>
          {offline.map(row)}
        </Group>
      )}
      {q.trim() && !list.length && <p className="px-4 text-[12.5px] text-dim">{t("social.add.none")}</p>}
    </div>
  );
}

function SideCard({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border border-line bg-surface/60">
      <header className="flex h-10 items-center justify-between border-b border-line px-4">
        <span className="eyebrow">{title}</span>
        {right}
      </header>
      {children}
    </section>
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
    <SideCard title={t("social.profile.title")}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="relative">
          <Avatar user={me} size={40} />
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 border-2 border-black ${dot}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white">{me.name}</div>
          <div className="truncate text-[12px] text-muted">{t("social.profile.vibe")}</div>
        </div>
      </div>
      <div className="border-t border-line px-4 py-3">
        <Select<PresenceStatusSetting>
          size="sm"
          className="w-full"
          value={me.presenceStatus}
          onChange={setStatus}
          options={(["online", "away", "busy", "invisible"] as const).map((k) => ({ value: k, label: t(`social.status.${k}`) }))}
        />
      </div>
    </SideCard>
  );
}

function HostingCard() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), staleTime: 30_000 });
  const l = q.data;
  return (
    <SideCard title={t("social.hosting.title")} right={<Radio size={13} className="text-dim" />}>
      <div className="px-4 py-3.5">
        {!l ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <>
            {!l.enabled && <p className="mb-2 text-[12px] text-warn">{t("social.hosting.disabled")}</p>}
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-muted">{t("social.hosting.active")}</span>
              <span className="font-mono text-white">
                {l.active} / {l.maxHosts}
              </span>
            </div>
            <div className="mt-2 h-1 bg-white/[.06]">
              <div className="h-full bg-brand" style={{ width: `${l.maxHosts ? Math.min(100, (l.active / l.maxHosts) * 100) : 0}%` }} />
            </div>
            <p className="mt-2.5 text-[12px] text-dim">{l.maxPlayersPerHost ? t("social.hosting.players", { n: l.maxPlayersPerHost }) : t("social.hosting.players_any")}</p>
          </>
        )}
      </div>
    </SideCard>
  );
}

function HostsCard({ hosts }: { hosts: HostSession[] }) {
  const t = useT();
  if (!hosts.length) return null;
  return (
    <SideCard title={t("social.hosts.title")} right={<span className="h-1.5 w-1.5 animate-pulse bg-ok" />}>
      {hosts.map((h) => (
        <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-line">
          <Avatar user={h.host} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{t("social.hosts.hosting", { name: h.host.name })}</div>
            <div className="truncate text-[11.5px] text-muted">
              {h.mcVersion ?? "?"} · {t("social.hosts.players", { n: h.players.length })}
            </div>
          </div>
          <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={() => openInviteAccept({ host: h })}>
            {t("social.accept.join")}
          </Button>
        </div>
      ))}
    </SideCard>
  );
}

export function Overview() {
  const vibe = useVibe();
  const hosts = useSocial((s) => s.hosts);
  const motd = useSocial((s) => s.motd);
  const friends = useFriends();
  const hostsByUser = useMemo(() => {
    const m: Record<string, HostSession> = {};
    for (const h of Object.values(hosts)) if (h.status === "online" && h.address) m[h.host.id] = h;
    return m;
  }, [hosts]);
  return (
    <div className="scroll h-full">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-6 px-2 py-5 min-[1240px]:grid-cols-[minmax(0,1fr)_280px] min-[1240px]:px-6">
        <div className="min-w-0">
          {motd && <div className="mx-4 mb-5 border border-warn/40 bg-warn/10 px-4 py-2.5 text-[13px] text-warn">{motd}</div>}
          {friends.length ? <FriendGroups friends={friends} hosts={hostsByUser} /> : <NoFriends />}
        </div>
        <aside className="flex flex-col gap-4 px-4 min-[1240px]:px-0">
          <HostsCard hosts={Object.values(hostsByUser)} />
          <ProfileCard />
          {vibe.hosting && <HostingCard />}
        </aside>
      </div>
    </div>
  );
}
