// Entdecken: Modrinth/CurseForge durchsuchen. Suchbegriff/Typ/Quelle/Ziel-Instanz stehen in den Search-Params,
// übrige Filter im Store (bleiben beim Zurücknavigieren erhalten). Ergebnisse virtualisiert + Endlos-Scrollen.
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Check, Info, RotateCcw, SearchX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, Segmented, Select, SearchInput, Skeleton, Spinner, Tabs, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatLoader, instanceAccent } from "@/lib/format";
import { qk, useGameVersions, useInstances, useSettings, useSystemInfo } from "@/lib/queries";
import type { LoaderKind, ProjectHit, ProjectType, SearchQuery, SortOrder, Source } from "@/lib/types";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { prettyCategory } from "@/components/content/Pill";
import { compareMc, contentKindOf } from "@/components/content/util";
import { CARD_H, ResultCard, ResultSkeleton } from "./ResultCard";
import { scrollOffsets, useDiscoverFilters } from "./store";

const route = getRouteApi("/discover");
const PAGE = 20;
const GAP = 6;
const ALL = "__all";
const LOADERS: LoaderKind[] = ["fabric", "neoforge", "forge", "quilt"];
const SORTS: SortOrder[] = ["relevance", "downloads", "follows", "newest", "updated"];
const FALLBACK_VERSIONS = ["1.21.11", "1.21.10", "1.21.8", "1.21.5", "1.21.4", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9", "1.7.10"];

/** Tab der Instanzseite, der zu einem Projekttyp gehört. */
function instanceTabFor(type: ProjectType) {
  return type === "resourcepack" ? "resourcepacks" : type === "shader" ? "shaders" : "content";
}

export function DiscoverPage() {
  const t = useT();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const nav = useNavigate();
  const sys = useSystemInfo();
  const cfAvailable = !!sys.data?.curseforge_available;
  const stores = useQuery({ queryKey: ["stores"], queryFn: api.storesList, staleTime: 5 * 60_000 });
  const enabledStores = (stores.data ?? []).filter((s) => s.enabled && !s.error);
  const storeSource = search.source?.startsWith("store:") && enabledStores.some((s) => `store:${s.id}` === search.source) ? search.source : null;
  const source: Source = storeSource ?? (search.source === "curseforge" && cfAvailable ? "curseforge" : "modrinth");
  const instances = useInstances();
  const target = useMemo(() => (search.instance ? (instances.data?.find((i) => i.id === search.instance) ?? null) : null), [instances.data, search.instance]);
  const type: ProjectType = search.type ?? "mod";
  const effectiveType: ProjectType = target && type === "modpack" ? "mod" : type;

  // Filter aus der Ziel-Instanz vorbelegen
  const applyInstance = useDiscoverFilters((s) => s.applyInstance);
  useEffect(() => {
    if (search.instance && !target) return; // Instanzen laden noch
    applyInstance(target);
  }, [target, search.instance, applyInstance]);
  const filters = useDiscoverFilters();

  // Suchfeld lokal, Search-Param entprellt (250 ms)
  const [text, setText] = useState(search.q ?? "");
  useEffect(() => setText(search.q ?? ""), [search.q]);
  useEffect(() => {
    if ((search.q ?? "") === text) return;
    const h = setTimeout(() => navigate({ search: (s) => ({ ...s, q: text || undefined }), replace: true }), 250);
    return () => clearTimeout(h);
  }, [text, search.q, navigate]);

  const loaderApplies = effectiveType === "mod" || effectiveType === "modpack";
  const query: Omit<SearchQuery, "offset" | "limit"> = {
    source,
    query: search.q ?? "",
    project_type: effectiveType,
    game_version: filters.version,
    loader: loaderApplies ? filters.loader : null,
    categories: filters.categories,
    sort: filters.sort,
  };
  const queryKeyStr = JSON.stringify(query);

  const results = useInfiniteQuery({
    queryKey: qk.search(query),
    queryFn: ({ pageParam }) => api.contentSearch({ ...query, offset: pageParam, limit: PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hits.length > 0 && last.offset + last.hits.length < last.total ? last.offset + last.hits.length : undefined),
    // Alte Treffer nur beim Tippen/Filtern stehen lassen – nicht beim Wechsel von Typ oder Quelle
    placeholderData: (prev, prevQuery) => {
      const k = prevQuery?.queryKey[1] as typeof query | undefined;
      return k && k.project_type === query.project_type && k.source === query.source ? keepPreviousData(prev) : undefined;
    },
    staleTime: 5 * 60_000,
    retryDelay: 500,
    enabled: !(search.source === "curseforge" && !cfAvailable),
  });
  const hits = useMemo(() => {
    const seen = new Set<string>();
    const out: ProjectHit[] = [];
    for (const p of results.data?.pages ?? []) for (const h of p.hits) if (!seen.has(h.id)) (seen.add(h.id), out.push(h));
    return out;
  }, [results.data]);
  const total = results.data?.pages[0]?.total ?? 0;

  // Bereits installierte Projekte der Ziel-Instanz
  const kind = contentKindOf(effectiveType);
  const installedQ = useQuery({
    queryKey: qk.content(target?.id ?? "", kind ?? "mod"),
    queryFn: () => api.contentList(target!.id, kind!),
    enabled: !!target && !!kind,
  });
  const installed = useMemo(() => new Set((installedQ.data ?? []).map((c) => c.project_id).filter(Boolean) as string[]), [installedQ.data]);

  const instanceList = instances.data ?? [];
  const onOpen = useCallback(
    (hit: ProjectHit) => nav({ to: "/project/$source/$id", params: { source: hit.source, id: hit.id }, search: { instance: search.instance } }),
    [nav, search.instance],
  );

  const setType = (v: ProjectType) => {
    useDiscoverFilters.getState().set({ categories: [] });
    navigate({ search: (s) => ({ ...s, type: v === "mod" ? undefined : v }), replace: true });
  };

  const typeItems = (["mod", "modpack", "resourcepack", "shader", "datapack"] as ProjectType[])
    .filter((v) => !(target && v === "modpack"))
    .map((v) => ({ value: v, label: t(`discover.tab.${v}`) }));

  const curseforgeBlocked = search.source === "curseforge" && !cfAvailable && !sys.isPending;

  return (
    <div className="flex h-full flex-col">
      {search.instance && <TargetBanner instanceId={search.instance} type={effectiveType} />}
      <div className="flex min-h-0 flex-1">
        <FilterSidebar type={effectiveType} source={source} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-5 pt-1">
            <Tabs
              value={effectiveType}
              onChange={setType}
              items={typeItems}
              className="-mx-3 h-11 border-b-0"
              right={
                <div className="flex items-center gap-1.5">
                  {!cfAvailable && !sys.isPending && (
                    <Tooltip content={t("discover.cf_disabled")}>
                      <Link to="/settings" aria-label={t("discover.cf_disabled")} className="grid h-8 w-8 place-items-center text-dim hover:text-white">
                        <Info size={15} />
                      </Link>
                    </Tooltip>
                  )}
                  <Segmented
                    value={storeSource ?? (search.source === "curseforge" ? "curseforge" : "modrinth")}
                    onChange={(v: Source) => navigate({ search: (s) => ({ ...s, source: v === "modrinth" ? undefined : v }), replace: true })}
                    items={[
                      { value: "modrinth", label: "Modrinth" },
                      { value: "curseforge", label: "CurseForge", disabled: !cfAvailable },
                      ...enabledStores.map((s) => ({
                        value: `store:${s.id}` as Source,
                        label: (
                          <span className="flex items-center gap-1.5">
                            {s.icon && <img src={s.icon} alt="" width={16} height={16} className="h-4 w-4 object-contain" />}
                            {s.name}
                          </span>
                        ),
                      })),
                    ]}
                  />
                </div>
              }
            />
            <div className="flex items-center gap-2.5 pt-2">
              <SearchInput
                value={text}
                onChange={setText}
                placeholder={t(`discover.search.${effectiveType}`)}
                className="min-w-0 flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape" && text) setText("");
                }}
              />
              <div className="w-[200px] shrink-0">
                <Select
                  value={filters.sort}
                  onChange={(v: SortOrder) => useDiscoverFilters.getState().set({ sort: v })}
                  options={SORTS.map((s) => ({ value: s, label: t(`discover.sort.${s}`) }))}
                />
              </div>
            </div>
            <div className="flex h-8 items-center gap-2 text-[12.5px] text-dim">
              {results.data && !curseforgeBlocked && <span>{t("discover.results", { n: total.toLocaleString() })}</span>}
              {results.isFetching && !results.isFetchingNextPage && <Spinner size={11} className="text-accent" />}
            </div>
          </div>
          {curseforgeBlocked ? (
            <EmptyState
              icon={<Info size={28} />}
              title={t("discover.cf_title")}
              text={t("discover.cf_text")}
              action={
                <Link to="/settings" className="inline-flex h-8 items-center gap-2 border border-line bg-surface2 px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface3 hover:border-line2">
                  {t("discover.cf_settings")}
                </Link>
              }
            />
          ) : (
            <ResultList
              key={queryKeyStr}
              keyStr={queryKeyStr}
              hits={hits}
              status={results.status}
              error={results.error}
              placeholder={results.isPlaceholderData}
              hasNext={!!results.hasNextPage}
              fetchingNext={results.isFetchingNextPage}
              nextError={results.isFetchNextPageError}
              fetchNext={() => void results.fetchNextPage()}
              retry={() => void results.refetch()}
              target={target}
              installed={installed}
              instances={instanceList}
              onOpen={onOpen}
              onReset={() => {
                setText("");
                useDiscoverFilters.getState().reset();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultList({
  keyStr,
  hits,
  status,
  error,
  placeholder,
  hasNext,
  fetchingNext,
  nextError,
  fetchNext,
  retry,
  target,
  installed,
  instances,
  onOpen,
  onReset,
}: {
  keyStr: string;
  hits: ProjectHit[];
  status: "pending" | "error" | "success";
  error: unknown;
  placeholder: boolean;
  hasNext: boolean;
  fetchingNext: boolean;
  nextError: boolean;
  fetchNext: () => void;
  retry: () => void;
  target: import("@/lib/types").Instance | null;
  installed: Set<string>;
  instances: import("@/lib/types").Instance[];
  onOpen: (h: ProjectHit) => void;
  onReset: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const tail = nextError ? 1 : hasNext ? 3 : 0;
  const count = status === "pending" ? 8 : hits.length + tail;
  const v = useVirtualizer({
    count,
    getScrollElement: () => ref.current,
    estimateSize: () => CARD_H + GAP,
    overscan: 6,
    paddingStart: 2,
    paddingEnd: 16,
    initialOffset: () => scrollOffsets.get(keyStr) ?? 0,
    onChange: (inst) => {
      scrollOffsets.set(keyStr, inst.scrollOffset ?? 0);
    },
  });
  const items = v.getVirtualItems();
  const last = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (status === "success" && hasNext && !fetchingNext && !nextError && last >= hits.length - 4) fetchNext();
  }, [last, hits.length, hasNext, fetchingNext, nextError, status, fetchNext]);

  if (status === "error" && !hits.length) return <ErrorState error={error} onRetry={retry} className="flex-1" />;
  if (status === "success" && !hits.length)
    return (
      <EmptyState
        icon={<SearchX size={30} />}
        title={t("discover.empty")}
        text={t("discover.empty_text")}
        className="flex-1"
        action={
          <button onClick={onReset} className="inline-flex h-8 items-center gap-2 border border-line bg-surface2 px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface3 hover:border-line2">
            <RotateCcw size={13} />
            {t("discover.reset")}
          </button>
        }
      />
    );

  return (
    <div ref={ref} className={cn("scroll min-h-0 flex-1 transition-opacity duration-150", placeholder && "opacity-60")}>
      <div className="relative mx-5" style={{ height: v.getTotalSize() }}>
        {items.map((it) => {
          const hit = hits[it.index];
          return (
            <div key={hit ? hit.id : `s${it.index}`} className="absolute inset-x-0" style={{ top: it.start, height: CARD_H }}>
              {!hit && nextError ? (
                <div className="flex h-full items-center justify-center gap-3 border border-dashed border-line2 text-[13px] text-muted">
                  {t("discover.next_error")}
                  <button onClick={fetchNext} className="inline-flex h-8 items-center gap-2 border border-line bg-surface2 px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface3 hover:border-line2">
                    <RotateCcw size={13} />
                    {t("common.retry")}
                  </button>
                </div>
              ) : status === "pending" || !hit ? (
                <ResultSkeleton />
              ) : (
                <ResultCard hit={hit} target={target} installed={installed.has(hit.id)} instances={instances} onOpen={onOpen} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TargetBanner({ instanceId, type }: { instanceId: string; type: ProjectType }) {
  const t = useT();
  const navigate = route.useNavigate();
  const { data: instances, isPending } = useInstances();
  const inst = instances?.find((i) => i.id === instanceId);
  const accent = inst ? instanceAccent(inst.id, inst.accent) : "var(--color-brand)";
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4" style={{ boxShadow: `inset 3px 0 0 ${accent}` }}>
      {inst ? <InstanceBadge instance={inst} size={22} /> : <Skeleton className="h-[22px] w-[22px]" />}
      <div className="min-w-0 flex-1 truncate text-[13px] text-muted">
        {isPending ? (
          t("common.loading")
        ) : inst ? (
          <>
            {t("discover.target_prefix")} <b className="font-semibold text-white">{inst.name}</b>
            <span className="ml-2 font-mono text-[11.5px] text-dim">{`${inst.mc_version} · ${formatLoader(inst.loader)}`}</span>
          </>
        ) : (
          t("discover.target_missing")
        )}
      </div>
      {inst && (
        <Link
          to="/instances/$id"
          params={{ id: inst.id }}
          search={{ tab: instanceTabFor(type) }}
          className="inline-flex h-7 items-center gap-1.5 border border-line bg-surface2 px-2.5 text-[12.5px] font-semibold text-text transition-colors hover:bg-surface3"
        >
          <ArrowLeft size={13} />
          {t("discover.back_to_instance")}
        </Link>
      )}
      <Tooltip content={t("discover.target_clear")}>
        <button
          aria-label={t("discover.target_clear")}
          className="grid h-7 w-7 place-items-center text-dim transition-colors hover:text-white"
          onClick={() => navigate({ search: (s) => ({ ...s, instance: undefined }), replace: true })}
        >
          <X size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

function FilterGroup({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5">
      <div className="flex h-5 items-center justify-between">
        <span className="text-[13px] font-semibold text-white">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Auswahlzeile mit Kästchen (wie die Filterlisten der Modrinth App). */
function CheckRow({ on, label, onClick }: { on: boolean; label: React.ReactNode; onClick: () => void }) {
  return (
    <button
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center gap-2.5 px-1 text-left text-[13px] transition-colors duration-100 hover:bg-white/[.04]",
        on ? "text-white" : "text-muted hover:text-text",
      )}
    >
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center border transition-colors duration-100", on ? "border-brand bg-brand text-white" : "border-line2")}>
        {on && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function FilterSidebar({ type, source }: { type: ProjectType; source: Source }) {
  const t = useT();
  const f = useDiscoverFilters();
  const gv = useGameVersions();
  const settings = useSettings();
  const versions = useMemo(() => {
    const list = gv.data?.length
      ? gv.data.filter((v) => v.kind === "release" || (settings.data?.show_snapshots && v.kind === "snapshot")).map((v) => v.id)
      : FALLBACK_VERSIONS;
    const all = f.version && !list.includes(f.version) ? [f.version, ...list] : list;
    return [...new Set(all)].sort((a, b) => (/^\d/.test(a) && /^\d/.test(b) ? compareMc(b, a) : 0));
  }, [gv.data, settings.data?.show_snapshots, f.version]);

  const cats = useQuery({
    queryKey: qk.categories(source, type),
    queryFn: () => api.contentCategories(source, type),
    staleTime: 60 * 60_000,
    placeholderData: undefined,
  });

  const active = !!(f.version || f.loader || f.categories.length || f.sort !== "relevance");
  const loaderApplies = type === "mod" || type === "modpack";

  return (
    <aside className="scroll w-[232px] shrink-0 border-r border-line">
      <FilterGroup
        title={t("discover.filter.version")}
        right={
          active && (
            <Tooltip content={t("discover.reset")}>
              <button aria-label={t("discover.reset")} onClick={() => f.reset()} className="grid h-6 w-6 place-items-center text-dim transition-colors hover:text-white">
                <RotateCcw size={13} />
              </button>
            </Tooltip>
          )
        }
      >
        <Select
          size="sm"
          value={f.version ?? ALL}
          onChange={(v) => f.set({ version: v === ALL ? null : v })}
          options={[{ value: ALL, label: t("discover.filter.all_versions") }, ...versions.map((v) => ({ value: v, label: v }))]}
        />
      </FilterGroup>
      {loaderApplies && (
        <FilterGroup title={t("discover.filter.loader")}>
          <div className="flex flex-col">
            {LOADERS.map((l) => (
              <CheckRow key={l} on={f.loader === l} label={formatLoader({ kind: l, version: null })} onClick={() => f.set({ loader: f.loader === l ? null : l })} />
            ))}
          </div>
        </FilterGroup>
      )}
      <FilterGroup
        title={t("discover.filter.categories")}
        right={
          f.categories.length > 0 && (
            <button className="text-[12px] text-dim hover:text-white" onClick={() => f.set({ categories: [] })}>
              {t("discover.filter.clear")}
            </button>
          )
        }
      >
        {cats.isPending ? (
          <div className="flex flex-col gap-1.5">
            {[70, 90, 60, 84, 66, 78].map((w, i) => (
              <Skeleton key={i} className="h-5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : cats.isError ? (
          <button className="text-left text-[12px] text-dim hover:text-white" onClick={() => cats.refetch()}>
            {t("discover.filter.cats_error")}
          </button>
        ) : (
          <div className="flex flex-col">
            {(cats.data ?? []).map((c) => {
              const on = f.categories.includes(c.id);
              return (
                <CheckRow
                  key={c.id}
                  on={on}
                  label={prettyCategory(c.name)}
                  onClick={() => f.set({ categories: on ? f.categories.filter((x) => x !== c.id) : [...f.categories, c.id] })}
                />
              );
            })}
          </div>
        )}
      </FilterGroup>
    </aside>
  );
}
