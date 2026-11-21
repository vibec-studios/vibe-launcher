// Startansicht der Freunde-Seite (kein Chat gewählt): Werkzeugleiste (Filter links, Aktionen rechts); darunter
// prominent die Welten/Server, die Freunde gerade hosten („Beitreten“), offene Anfragen und Einladungen, dann die
// Freundesliste (spielt gerade / online / offline). Rechts das eigene Profil (Skin, Status, Statustext) und das
// Hosting-Kontingent.
import { useQuery } from "@tanstack/react-query";
import { MyHostsSection } from "@/features/hostpanel/MyHosts";
import { InviteFriendsCard } from "@/features/accessinvite/InviteFriends";
import { Check, Mail, Megaphone, Pencil, Play, Radio, UserPlus, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, IconButton, PageToolbar, SearchInput, Select, Skeleton, Spinner, Tooltip, cn, pageWrap, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import { useVibe } from "@/lib/vibe";
import type { Friend, FriendRequest, HostSession, Invite, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { Avatar, FriendListRow, skinUrlOf } from "./FriendsList";
import { useFriends } from "./hooks";
import { loaderName, since } from "./presence";
import { SocialActions, openPageDialog } from "./PageActions";
import { openInviteAccept } from "./dialogStore";
import { renderBody, useRender } from "./skinRender";
import { FeedCard } from "@/features/feed/FeedCard";
import { errText, refreshRequests, removeInviteLocal, requireClient, useSocial, vqk } from "./service";

/** Robbe als freundliche Illustration für leere Zustände. */
export function SealArt({ size = 132, className }: { size?: number; className?: string }) {
  return <img src="/logo-seal.png" alt="" width={size} height={size} draggable={false} className={cn("object-contain", className)} style={{ width: size, height: size }} />;
}

function Group({ title, count, children, tone }: { title: string; count: number; children: ReactNode; tone?: "brand" | "ok" | "dim" }) {
  return (
    <section className="flex flex-col">
      <header className="flex h-8 items-center gap-2 px-3">
        <span className={cn("h-2 w-2 rounded-dot", tone === "brand" ? "bg-brand" : tone === "ok" ? "bg-ok" : "bg-[#4a4a52]")} />
        <h3 className="text-[12.5px] font-semibold text-muted">{title}</h3>
        <span className="text-caption tabular-nums text-dim">{count}</span>
      </header>
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  );
}

function NoFriends() {
  const t = useT();
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <SealArt size={150} />
      <h2 className="mt-4 text-[18px] font-bold tracking-[-0.01em] text-text">{t("social.empty.title")}</h2>
      <p className="mt-1.5 max-w-[420px] text-[13.5px] leading-relaxed text-muted">{t("social.empty.text")}</p>
      <Button variant="primary" className="mt-5" icon={<UserPlus size={15} />} onClick={() => openPageDialog("add")}>
        {t("social.action.add")}
      </Button>
      <p className="mt-3 text-[12px] text-dim">{t("social.empty.hint")}</p>
    </div>
  );
}

function FriendGroups({ friends, hosts, q }: { friends: Friend[]; hosts: Record<string, HostSession>; q: string }) {
  const t = useT();
  const list = q ? friends.filter((f) => f.user.name.toLowerCase().includes(q)) : friends;
  const playing = list.filter((f) => f.presence.status !== "offline" && (f.presence.activity?.type === "playing" || f.presence.activity?.type === "hosting"));
  const online = list.filter((f) => f.presence.status !== "offline" && !playing.includes(f));
  const offline = list.filter((f) => f.presence.status === "offline");
  const row = (f: Friend) => <FriendListRow key={f.user.id} friend={f} host={hosts[f.user.id]} />;
  if (q && !list.length) return <p className="px-3 py-6 text-center text-[13px] text-dim">{t("social.friends.no_match", { q })}</p>;
  return (
    <div className="flex flex-col gap-5">
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
        <Group title={t("social.friends.offline_title")} count={offline.length} tone="dim">
          {offline.map(row)}
        </Group>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Hosts von Freunden (prominent)

function HostCard({ h, friend }: { h: HostSession; friend: Friend | undefined }) {
  const t = useT();
  const friends = useSocial((s) => s.friends);
  const me = useSocial((s) => s.me);
  // Mitspieler als bekannte Nutzer (Skin), sonst Kopf über die UUID
  const userOf = (p: HostSession["players"][number]) => (p.uuid && (friends[p.uuid]?.user ?? (me?.id === p.uuid ? me : null))) || { id: p.uuid ?? p.name, name: p.name };
  const a = friend?.presence.activity;
  const title = a?.world ?? a?.instanceName ?? t("social.hosts.world_of", { name: h.host.name });
  const meta = [h.mcVersion ?? a?.mcVersion, a?.loader && a.loader !== "vanilla" ? loaderName(a.loader) : null].filter(Boolean).join(" · ");
  const up = since(h.onlineAt ?? h.startedAt, t);
  return (
    <div className="group flex flex-col gap-3 rounded-card bg-surface p-4 transition-colors duration-150 hover:bg-surface2">
      <div className="flex items-start gap-3">
        <Avatar user={h.host} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-brand">
            <Radio size={12} strokeWidth={2.4} />
            {t("social.hosts.hosting", { name: h.host.name })}
          </div>
          <div className="mt-0.5 truncate text-[16px] font-bold leading-tight tracking-[-0.01em] text-text">{title}</div>
          <div className="mt-0.5 truncate text-[12px] text-dim">{[meta, up ? t("social.hosts.up", { time: up }) : null].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex items-center -space-x-1">
            {h.players.slice(0, 6).map((p) => (
              <Tooltip key={p.name} content={p.name}>
                <span className="rounded-xs ring-2 ring-[var(--surface-1)] transition-[box-shadow] group-hover:ring-[var(--surface-2)]">
                  <Avatar user={userOf(p)} size={22} />
                </span>
              </Tooltip>
            ))}
          </div>
          <span className="truncate text-[12px] tabular-nums text-muted">
            {h.maxPlayers ? t("social.hosts.players_of", { n: h.players.length, max: h.maxPlayers }) : t("social.hosts.players", { n: h.players.length })}
          </span>
        </div>
        <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ host: h })}>
          {t("social.accept.join")}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Anfragen + Einladungen

function RequestCard({ r }: { r: FriendRequest }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refreshRequests();
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3 animate-fade-in">
      <Avatar user={r.from} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-text">{r.from.name}</div>
        <div className="truncate text-[12px] text-dim">
          {t("social.req.incoming")} · {formatRelative(r.createdAt)}
        </div>
      </div>
      {busy ? (
        <Spinner size={13} className="mx-2" />
      ) : (
        <>
          <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => void act(() => requireClient().friends.accept(r.id))}>
            {t("social.req.accept")}
          </Button>
          <IconButton label={t("social.req.decline")} tip size="sm" variant="ghost" onClick={() => void act(() => requireClient().friends.decline(r.id))}>
            <X size={15} />
          </IconButton>
        </>
      )}
    </div>
  );
}

function InviteCard({ inv }: { inv: Invite }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const decline = async () => {
    setBusy(true);
    try {
      await requireClient().invites.decline(inv.id);
      removeInviteLocal(inv.id);
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  const meta = [inv.target.mcVersion, inv.target.loader && inv.target.loader !== "vanilla" ? loaderName(inv.target.loader) : null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3 animate-fade-in">
      <span className="relative">
        <Avatar user={inv.from} size={36} />
        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-dot bg-brand text-[var(--ui-on-accent)] ring-2 ring-[var(--surface-1)]">
          <Mail size={9} strokeWidth={2.6} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-text">
          <b className="font-semibold">{inv.from.name}</b> <span className="text-muted">{t("social.invite.lead")}</span> <b className="font-semibold">{inv.target.name}</b>
        </div>
        <div className="truncate text-[12px] text-dim">
          {meta || t(`social.invite.kind.${inv.kind}`)}
          {inv.message ? ` · „${inv.message}“` : ""}
        </div>
      </div>
      {busy ? (
        <Spinner size={13} className="mx-2" />
      ) : (
        <>
          <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ invite: inv })}>
            {t("social.accept.join")}
          </Button>
          <IconButton label={t("social.invite.decline")} tip size="sm" variant="ghost" onClick={() => void decline()}>
            <X size={15} />
          </IconButton>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Seitenspalte: Du + Hosting

function ProfileCard() {
  const t = useT();
  const me = useSocial((s) => s.me);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const skin = skinUrlOf(me);
  const slim = me?.skin.model === "slim";
  const body = useRender(skin ? `${skin}|${slim}` : null, () => renderBody(skin!, slim)).url;
  if (!me) return null;
  const setStatus = async (s: PresenceStatusSetting) => {
    useSocial.setState({ me: { ...me, presenceStatus: s } });
    try {
      await requireClient().presence.set({ status: s });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const saveText = async () => {
    const v = text.trim() || null;
    setEditing(false);
    if (v === me.statusText) return;
    useSocial.setState({ me: { ...me, statusText: v } });
    try {
      await requireClient().me.update({ statusText: v });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const dot = { online: "bg-ok", away: "bg-warn", busy: "bg-danger", invisible: "bg-[#4a4a52]" }[me.presenceStatus] ?? "bg-ok";
  return (
    <section className="overflow-hidden rounded-card bg-surface">
      <div className="flex items-end gap-4 px-4 pt-4">
        <div className="grid h-[120px] w-[60px] shrink-0 place-items-end">
          {body ? <img src={body} alt="" draggable={false} className="h-[120px] w-[60px] animate-fade-in [image-rendering:pixelated]" /> : <Avatar user={me} size={48} />}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="text-[11.5px] font-semibold text-dim">{t("social.profile.you")}</div>
          <div className="truncate text-[17px] font-bold leading-tight tracking-[-0.01em] text-text">{me.name}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cn("h-2 w-2 rounded-dot", dot)} />
            {t(`social.status.${me.presenceStatus}`)}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {editing ? (
          <input
            autoFocus
            value={text}
            maxLength={80}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void saveText()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveText();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder={t("social.profile.status_ph")}
            className="h-8 w-full rounded-ctl bg-field px-2.5 text-[13px] text-text outline-none placeholder:text-dim focus:shadow-[inset_0_0_0_1px_var(--line-2)]"
          />
        ) : (
          <button
            onClick={() => {
              setText(me.statusText ?? "");
              setEditing(true);
            }}
            className="group flex min-h-8 w-full items-center gap-2 rounded-ctl bg-white/[.03] px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[.06]"
          >
            <span className={cn("min-w-0 flex-1 truncate", me.statusText ? "text-text" : "text-dim")}>{me.statusText ? `„${me.statusText}“` : t("social.profile.status_ph")}</span>
            <Pencil size={12} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <Select<PresenceStatusSetting>
          size="sm"
          className="w-full"
          value={me.presenceStatus}
          onChange={setStatus}
          options={(["online", "away", "busy", "invisible"] as const).map((k) => ({ value: k, label: t(`social.status.${k}`) }))}
        />
      </div>
    </section>
  );
}

function HostingCard() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), staleTime: 30_000 });
  const l = q.data;
  return (
    <section className="rounded-card bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-text">{t("social.hosting.title")}</h3>
        {l && <span className="text-[12px] tabular-nums text-muted">{t("social.hosting.card_count", { active: l.active, max: l.maxHosts })}</span>}
      </div>
      {!l ? (
        <Skeleton className="mt-3 h-4 w-40" />
      ) : (
        <>
          {!l.enabled && <p className="mt-2 text-[12px] text-warn">{t("social.hosting.disabled")}</p>}
          <div className="mt-2.5 flex gap-1">
            {Array.from({ length: Math.max(1, l.maxHosts) }, (_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-pill", i < l.active ? "bg-brand" : "bg-surface3")} />
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            {t("social.hosting.explain", { max: l.maxHosts })}{" "}
            {l.maxPlayersPerHost ? t("social.hosting.card_players", { n: l.maxPlayersPerHost }) : t("social.hosting.card_players_any")}
          </p>
        </>
      )}
    </section>
  );
}

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
