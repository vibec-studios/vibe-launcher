import { useMemo, useState } from "react";
import { Compass, Copy, ListChecks, Play, Plus, Users } from "lucide-react";
import { Button, EmptyState, ErrorState, PageToolbar, SearchInput, Select, Skeleton, Tag, ToolbarButton, Tooltip, cn, pageWrap, toast } from "@/components/ui";
import { Motd, PingBars, usePing } from "@/components/instance/motd";
import { copyText } from "@/components/content/util";
import { useT } from "@/i18n";
import type { DiscoveryCategory, DiscoveryServer, Friend } from "@/lib/vibe-sdk";
import { Avatar } from "@/features/social/FriendsList";
import { useFriends } from "@/features/social/hooks";
import { useSocial } from "@/features/social/service";
import { CATEGORIES, useDiscovery } from "./api";
import { friendsOn } from "./match";
import { JoinDialog } from "./JoinDialog";
import { MySubmissionsDialog, SubmitDialog } from "./SubmitDialog";

const ALL = "__all";

function FriendsHere({ list }: { list: Friend[] }) {
  const t = useT();
  if (!list.length) return null;
  return (
    <Tooltip content={list.map((f) => f.user.name).join(", ")}>
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-brand">
        <span className="flex -space-x-1.5">
          {list.slice(0, 3).map((f) => (
            <Avatar key={f.user.id} user={f.user} size={18} />
          ))}
        </span>
        {t(list.length === 1 ? "discovery.friends_one" : "discovery.friends", { n: list.length })}
      </span>
    </Tooltip>
  );
}

function ServerCard({ s, friends, onJoin }: { s: DiscoveryServer; friends: Friend[]; onJoin: (s: DiscoveryServer) => void }) {
  const t = useT();
  const ping = usePing(s.address);
  const p = ping.data;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2">
          {p?.favicon ? <img src={p.favicon} alt="" className="h-full w-full [image-rendering:pixelated]" /> : <Compass size={20} className="text-dim" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-text">{s.name}</h3>
            <Tag>{t(`discovery.cat.${s.category}`)}</Tag>
          </div>
          <button
            onClick={() => void copyText(s.address).then(() => toast.success(t("discovery.copied")))}
            className="mt-0.5 flex max-w-full items-center gap-1 truncate font-mono text-[12px] text-dim transition-colors hover:text-text"
            title={t("discovery.copy_address")}
          >
            {s.address}
            <Copy size={11} className="shrink-0" />
          </button>
        </div>
      </div>
      <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted">{s.description}</p>
      {p?.online && p.motd && <Motd text={p.motd} className="line-clamp-2 rounded-ctl bg-black/30 px-2.5 py-1.5" />}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        {ping.isLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : p?.online ? (
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <PingBars status={p} />
            {p.latency_ms} ms
            {p.players_online != null && (
              <span className="flex items-center gap-1">
                <Users size={12} />
                {p.players_online.toLocaleString()}
              </span>
            )}
            {p.version && <span className="max-w-[140px] truncate text-dim">{p.version}</span>}
          </span>
        ) : (
          <span className="text-[12px] text-danger">{t("discovery.ping.offline")}</span>
        )}
        <FriendsHere list={friends} />
        <Button variant="primary" size="sm" className="ml-auto" icon={<Play size={13} />} disabled={!p?.online} onClick={() => onJoin(s)}>
          {t("discovery.play")}
        </Button>
      </div>
    </article>
  );
}

export function DiscoveryView() {
  const t = useT();
  const [cat, setCat] = useState<DiscoveryCategory | null>(null);
  const [query, setQuery] = useState("");
  const [join, setJoin] = useState<DiscoveryServer | null>(null);
  const [submit, setSubmit] = useState(false);
  const [mine, setMine] = useState(false);
  const linked = useSocial((s) => s.linked);
  const q = useDiscovery(cat);
  const friends = useFriends();
  const qq = query.trim().toLowerCase();
  const list = useMemo(
    () => (q.data?.servers ?? []).filter((s) => !qq || s.name.toLowerCase().includes(qq) || s.address.toLowerCase().includes(qq) || s.description.toLowerCase().includes(qq)),
    [q.data, qq],
  );
  const withFriends = useMemo(() => list.map((s) => ({ s, f: friendsOn(friends, s.address) })).sort((a, b) => b.f.length - a.f.length), [list, friends]);

  return (
    <div className="flex h-full flex-col">
      <div className={cn(pageWrap, "shrink-0 pb-4 pt-4")}>
        <PageToolbar
          actions={
            <>
              {linked && <ToolbarButton variant="subtle" icon={<ListChecks size={15} />} label={t("discovery.mine.title")} onClick={() => setMine(true)} />}
              <Button variant="primary" icon={<Plus size={16} />} disabled={!linked} onClick={() => setSubmit(true)}>
                {t("discovery.submit.title")}
              </Button>
            </>
          }
        >
          <SearchInput value={query} onChange={setQuery} placeholder={t("discovery.search")} aria-label={t("discovery.search")} className="min-w-[160px] max-w-[320px] flex-1 basis-[240px]" />
          <div className="w-[200px] min-w-[150px] shrink">
            <Select<string>
              value={cat ?? ALL}
              onChange={(v) => setCat(v === ALL ? null : (v as DiscoveryCategory))}
              options={[{ value: ALL, label: t("discovery.cat.all") }, ...CATEGORIES.map((c) => ({ value: c, label: t(`discovery.cat.${c}`) }))]}
            />
          </div>
        </PageToolbar>
      </div>
      <div className="scroll min-h-0 flex-1">
        <div className={cn(pageWrap, "flex flex-col gap-4 pb-12 pt-1")}>
          <div>
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-text">{t("discovery.title")}</h2>
            <p className="mt-1 max-w-[720px] text-[12.5px] leading-relaxed text-muted">{t("discovery.lead")}</p>
          </div>
          {q.isError && !q.data ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} className="rounded-panel bg-surface" />
          ) : !q.data ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
              {Array.from({ length: 6 }, (_, n) => (
                <Skeleton key={n} className="h-[190px] rounded-card" />
              ))}
            </div>
          ) : withFriends.length === 0 ? (
            <EmptyState
              className="rounded-panel bg-surface"
              icon="compass"
              title={qq || cat ? t("discovery.empty_filtered") : t("discovery.empty")}
              text={t("discovery.empty_text")}
              action={
                qq || cat ? (
                  <Button onClick={() => (setQuery(""), setCat(null))}>{t("discovery.reset")}</Button>
                ) : (
                  <Button variant="primary" icon={<Plus size={15} />} disabled={!linked} onClick={() => setSubmit(true)}>
                    {t("discovery.submit.title")}
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
              {withFriends.map(({ s, f }) => (
                <ServerCard key={s.id} s={s} friends={f} onJoin={setJoin} />
              ))}
            </div>
          )}
        </div>
      </div>
      <JoinDialog server={join} onClose={() => setJoin(null)} />
      <SubmitDialog open={submit} onClose={() => setSubmit(false)} />
      <MySubmissionsDialog open={mine} onClose={() => setMine(false)} />
    </div>
  );
}
