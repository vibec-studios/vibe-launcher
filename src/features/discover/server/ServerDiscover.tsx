import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpCircle, Check, Download, Info, Puzzle, RotateCcw, ServerOff, X } from "lucide-react";
import { create } from "zustand";
import { Button, EmptyState, ErrorState, IconButton, PageToolbar, SearchInput, Skeleton, Spinner, Tag, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatCount, formatRelative } from "@/lib/format";
import type { Source } from "@/lib/types";
import { providerOf, refreshTarget, tqk, useServerTarget, useTargetRunning } from "@/features/installtarget/hooks";
import { addonSupport } from "@/features/installtarget/registry";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import type { AddonHit, AddonSource, AddonUpdate } from "@/features/servers/addonsApi";
import { CheckRow, FilterGroup } from "../DiscoverPage";
import { useProjectOverlayNav } from "../ProjectOverlay";
import { TargetPicker } from "../TargetPicker";
import { AddonIcon, TargetIcon, softwareLabel, useServerInstall, useTargetAddons } from "./parts";
import { ServerSheet } from "./ServerSheet";

const route = getRouteApi("/discover");
const SORTS = ["relevance", "downloads", "updated"] as const;
type Sort = (typeof SORTS)[number];

const useServerDiscover = create<{ source: AddonSource; sort: Sort; set: (p: Partial<{ source: AddonSource; sort: Sort }>) => void }>((set) => ({
  source: "modrinth",
  sort: "relevance",
  set: (p) => set(p),
}));

export function hangarSupported(t: ServerTargetInfo | null) {
  return !!t?.platform && t.platform.kind !== "folia";
}

export function ServerDiscover({ serverKey }: { serverKey: string }) {
  const t = useT();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { target, pending, missing } = useServerTarget(serverKey);
  const kind = target ? addonSupport(target) : null;
  const store = useServerDiscover();
  const hangar = hangarSupported(target);
  const source: AddonSource = hangar ? store.source : "modrinth";

  const [text, setText] = useState(search.q ?? "");
  useEffect(() => setText(search.q ?? ""), [search.q]);
  useEffect(() => {
    if ((search.q ?? "") === text) return;
    const h = setTimeout(() => navigate({ search: (s) => ({ ...s, q: text || undefined }), replace: true }), 250);
    return () => clearTimeout(h);
  }, [text, search.q, navigate]);
  const q = (search.q ?? "").trim();

  const overlay = useProjectOverlayNav();
  const openHit = (h: Pick<AddonHit, "source" | "id">) => overlay.open(h.source as Source, h.id);

  return (
    <div className="relative flex h-full flex-col">
      {search.p && target && <ServerSheet target={target} value={search.p} />}
      <ServerTargetBanner target={target} pending={pending} />
      <div className="flex min-h-0 flex-1">
        <aside className="scroll flex w-[220px] shrink-0 flex-col px-3 pb-6 pt-4">
          <div className="mb-1 flex h-9 shrink-0 items-center gap-2 pl-2">
            <span className="flex-1 text-section text-text">{t("discover.filters")}</span>
          </div>
          <FilterGroup id="target" title={t("st.target.title")}>
            <TargetPicker />
          </FilterGroup>
          {target && kind && (
            <>
              <FilterGroup id="server-source" title={t("discover.source")}>
                <div className="flex flex-col gap-px" role="radiogroup" aria-label={t("discover.source")}>
                  <CheckRow radio on={source === "modrinth"} label="Modrinth" onClick={() => store.set({ source: "modrinth" })} />
                  {hangar ? (
                    <CheckRow radio on={source === "hangar"} label="Hangar" onClick={() => store.set({ source: "hangar" })} />
                  ) : (
                    <Tooltip content={t(kind === "plugins" ? "st.hangar.folia" : "st.hangar.mods")}>
                      <span className="flex h-7 items-center px-2 text-[13px] text-dim opacity-60">Hangar</span>
                    </Tooltip>
                  )}
                </div>
              </FilterGroup>
              <FilterGroup id="server-fit" title={t("st.fit.title")}>
                <div className="flex flex-col gap-1 px-2 text-[12.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <Check size={13} className="text-ok" />
                    Minecraft {target.mc_version}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Check size={13} className="text-ok" />
                    {softwareLabel(target)}
                  </span>
                  {kind === "mods" && (
                    <span className="flex items-center gap-1.5">
                      <Check size={13} className="text-ok" />
                      {t("st.fit.server_side")}
                    </span>
                  )}
                  <span className="mt-1 text-[11.5px] leading-snug text-dim">{t("st.fit.hint")}</span>
                </div>
              </FilterGroup>
              <FilterGroup id="server-sort" title={t("discover.sort")}>
                <div className="flex flex-col gap-px" role="radiogroup" aria-label={t("discover.sort")}>
                  {SORTS.map((s) => (
                    <CheckRow key={s} radio on={store.sort === s} label={t(`srv.addons.sort.${s}`)} onClick={() => store.set({ sort: s })} />
                  ))}
                </div>
              </FilterGroup>
            </>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-6 pt-4">
            <PageToolbar>
              <Tag color="var(--color-accent)">{kind === "plugins" ? t("st.kind.plugins") : t("st.kind.mods")}</Tag>
              <SearchInput
                value={text}
                onChange={setText}
                placeholder={kind === "plugins" ? t("srv.addons.search.plugins") : t("srv.addons.search.mods")}
                className="min-w-[180px] flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape" && text) setText("");
                }}
              />
            </PageToolbar>
          </div>
          {missing ? (
            <EmptyState
              icon={<ServerOff size={28} />}
              title={t("st.missing.title")}
              text={t("st.missing.text")}
              action={
                <Button variant="ghost" onClick={() => navigate({ search: (s) => ({ q: s.q }), replace: true })}>
                  {t("st.missing.back")}
                </Button>
              }
            />
          ) : !target ? (
            <div className="flex flex-col gap-2 px-6 pt-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !kind ? (
            <EmptyState
              icon={<Puzzle size={28} />}
              title={t("st.vanilla.title")}
              text={t("st.vanilla.text")}
              action={
                target.origin === "local" ? (
                  <Link to="/servers/$id" params={{ id: target.id }} search={{ tab: "settings" }} className="inline-flex h-8 items-center rounded-ctl bg-surface2 px-3 text-[13px] font-semibold text-text hover:bg-surface3">
                    {t("st.vanilla.cta")}
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ServerResults key={`${target.key}|${source}|${q}|${store.sort}`} target={target} source={source} query={q} sort={store.sort} onOpen={openHit} />
          )}
        </div>
      </div>
    </div>
  );
}

function ServerTargetBanner({ target, pending }: { target: ServerTargetInfo | null; pending: boolean }) {
  const t = useT();
  const navigate = route.useNavigate();
  const running = useTargetRunning(target);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-6" data-testid="server-target-banner">
      {target ? <TargetIcon target={target} size={22} /> : <Skeleton className="h-[22px] w-[22px] rounded-ctl" />}
      <div className="min-w-0 flex-1 truncate text-[13px] text-muted">
        {target ? (
          <>
            {t("st.banner.prefix")} <b className="font-semibold text-text">{target.name}</b>
            <span className="ml-2 text-meta text-dim">
              {`${softwareLabel(target)} · Minecraft ${target.mc_version}`}
              {target.origin === "remote" ? ` · ${target.agentName ?? t("st.remote")}` : ""}
            </span>
            {running && <span className="ml-2 text-meta text-warn">{t("st.banner.running")}</span>}
          </>
        ) : pending ? (
          t("common.loading")
        ) : (
          t("st.missing.title")
        )}
      </div>
      {target?.origin === "local" && (
        <Link
          to="/servers/$id"
          params={{ id: target.id }}
          search={{ tab: "addons" }}
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-semibold text-muted transition-colors duration-150 hover:bg-white/[.06] hover:text-text"
        >
          <ArrowLeft size={14} />
          {t("st.banner.back")}
        </Link>
      )}
      <IconButton label={t("st.banner.clear")} tip variant="ghost" size="sm" onClick={() => navigate({ search: (s) => ({ q: s.q }), replace: true })}>
        <X size={15} />
      </IconButton>
    </div>
  );
}

function ServerResults({
  target,
  source,
  query,
  sort,
  onOpen,
}: {
  target: ServerTargetInfo;
  source: AddonSource;
  query: string;
  sort: Sort;
  onOpen: (h: AddonHit) => void;
}) {
  const t = useT();
  const res = useInfiniteQuery({
    queryKey: tqk.search(target, source, query, sort),
    queryFn: ({ pageParam }) => providerOf(target).search(target, source, query, sort, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hits.length > 0 && last.offset + last.hits.length < last.total ? last.offset + last.hits.length : undefined),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const { addons, updates } = useTargetAddons(target);
  const { busy, install, update } = useServerInstall(target);
  const [updatingAll, setUpdatingAll] = useState(false);
  const items = addons.data?.items ?? [];
  const byProject = useMemo(() => new Map(items.filter((a) => a.project_id).map((a) => [a.project_id!, a])), [items]);
  const byName = useMemo(() => new Map(items.flatMap((a) => [a.title, a.name].filter(Boolean).map((n) => [n!.toLowerCase(), a] as const))), [items]);
  const ups = updates.data ?? [];
  const upByFile = useMemo(() => new Map(ups.map((u) => [u.file_name, u])), [ups]);
  const hits = useMemo(() => {
    const seen = new Set<string>();
    return (res.data?.pages ?? []).flatMap((p) => p.hits).filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
  }, [res.data]);
  const total = res.data?.pages[0]?.total ?? 0;

  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && res.hasNextPage && !res.isFetchingNextPage) void res.fetchNextPage();
      },
      { root: scroller.current, rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [res]);

  const updateAll = async () => {
    setUpdatingAll(true);
    try {
      await providerOf(target).update(target, null);
    } finally {
      setUpdatingAll(false);
      refreshTarget(target);
    }
  };

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 px-6">
        <span className="shrink-0 text-meta tabular-nums text-dim">{res.data ? t("discover.results", { n: formatCount(total) }) : ""}</span>
        {res.isFetching && !res.isFetchingNextPage && <Spinner size={11} className="text-brand" />}
        <div className="flex-1" />
        <span className="text-meta text-dim">{t("st.installed_count", { n: items.length })}</span>
        {ups.length > 0 && (
          <Button size="sm" variant="accent" icon={<ArrowUpCircle size={14} />} loading={updatingAll} onClick={updateAll}>
            {t("srv.addons.update_all", { n: ups.length })}
          </Button>
        )}
      </div>
      {res.isError && !res.data ? (
        <ErrorState error={res.error} onRetry={() => res.refetch()} className="flex-1" />
      ) : !res.data ? (
        <div className="flex flex-col gap-2 px-6">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-[76px]" />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <EmptyState icon={<Info size={26} />} title={t("discover.empty")} text={t("st.empty_text")} className="flex-1" />
      ) : (
        <div ref={scroller} className={cn("scroll min-h-0 flex-1 px-3 pb-6", res.isPlaceholderData && "opacity-60")} data-testid="server-results">
          {hits.map((h) => {
            const inst = byProject.get(h.id) ?? byName.get(h.title.toLowerCase());
            const have = !!inst;
            const up = inst ? upByFile.get(inst.file_name) : undefined;
            return (
              <AddonRow
                key={`${h.source}:${h.id}`}
                hit={h}
                installed={have}
                update={up}
                busy={busy === `${h.source}:${h.id}` || (!!inst && busy === `update:${inst.file_name}`)}
                disabled={!!busy}
                onOpen={() => onOpen(h)}
                onInstall={() => void install(h.source, h.id, h.title)}
                onUpdate={() => inst && void update(inst.file_name, h.title)}
              />
            );
          })}
          <div ref={sentinel} className="h-8" />
          {res.isFetchingNextPage && (
            <div className="grid h-10 place-items-center">
              <Spinner size={14} />
            </div>
          )}
          {res.isFetchNextPageError && (
            <div className="flex items-center justify-center gap-3 py-3 text-[13px] text-muted">
              {t("discover.next_error")}
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void res.fetchNextPage()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AddonRow({
  hit,
  installed,
  update,
  busy,
  disabled,
  onOpen,
  onInstall,
  onUpdate,
}: {
  hit: AddonHit;
  installed: boolean;
  update?: AddonUpdate;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex min-h-[76px] cursor-pointer items-center gap-3.5 rounded-card px-3 py-2.5 outline-none transition-colors hover:bg-white/[.03] focus-visible:bg-white/[.04]"
      data-testid="server-addon-row"
    >
      <AddonIcon src={hit.icon_url} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold text-text group-hover:underline">{hit.title}</span>
          <span className="shrink-0 truncate text-caption text-dim">{t("srv.addons.by", { author: hit.author })}</span>
        </div>
        <div className="truncate text-[12.5px] text-muted" title={hit.description}>
          {hit.description}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-caption text-dim">
          <span>{t("srv.addons.downloads", { n: formatCount(hit.downloads) })}</span>
          {hit.updated && <span>· {formatRelative(hit.updated)}</span>}
          <span>· {hit.source === "hangar" ? "Hangar" : "Modrinth"}</span>
        </div>
      </div>
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        {update ? (
          <Button size="sm" variant="accent" icon={<ArrowUpCircle size={13} />} loading={busy} disabled={disabled && !busy} onClick={onUpdate}>
            {t("st.update_to", { v: update.latest })}
          </Button>
        ) : installed ? (
          <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] font-semibold text-ok">
            <Check size={14} strokeWidth={2.5} />
            {t("common.installed")}
          </span>
        ) : (
          <Button size="sm" variant="ghost" icon={<Download size={13} />} loading={busy} disabled={disabled && !busy} onClick={onInstall}>
            {t("common.install")}
          </Button>
        )}
      </div>
    </div>
  );
}
