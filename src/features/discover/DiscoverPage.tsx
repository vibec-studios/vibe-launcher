// Entdecken: Modrinth/CurseForge durchsuchen. Suchbegriff/Typ/Quelle/Ziel-Instanz stehen in den Search-Params,
// übrige Filter im Store (bleiben beim Zurücknavigieren erhalten). Ergebnisse virtualisiert + Endlos-Scrollen.
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Check, ChevronDown, Info, RotateCcw, SearchX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, IconButton, Segmented, Select, SearchInput, Skeleton, Spinner, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { qk, useGameVersions, useInstances, useSettings, useSystemInfo } from "@/lib/queries";
import type { LoaderKind, ProjectHit, ProjectType, SearchQuery, SortOrder, Source } from "@/lib/types";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { prettyCategory } from "@/components/content/Pill";
import { compareMc, contentKindOf } from "@/components/content/util";
import { CARD_H, ResultCard, ResultSkeleton } from "./ResultCard";
import { scrollOffsets, useDiscoverFilters, useFilterGroups } from "./store";

const route = getRouteApi("/discover");
const PAGE = 20;
const GAP = 2;
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

  const sourceValue: Source = storeSource ?? (search.source === "curseforge" ? "curseforge" : "modrinth");

  return (
    <div className="flex h-full flex-col">
      {search.instance && <TargetBanner instanceId={search.instance} type={effectiveType} />}
      <div className="flex min-h-0 flex-1">
        <FilterSidebar type={effectiveType} source={source} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Eine Werkzeugleiste: Typ · Suche · Sortierung · Quelle */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-3">
            <Segmented value={effectiveType} onChange={setType} items={typeItems} />
            <SearchInput
              value={text}
              onChange={setText}
              placeholder={t(`discover.search.${effectiveType}`)}
              className="min-w-[180px] flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape" && text) setText("");
              }}
            />
            <Tooltip content={t("discover.sort")}>
              <div className="w-[176px] shrink-0 max-[1100px]:w-[150px]">
                <Select
                  size="sm"
                  variant="ghost"
                  value={filters.sort}
                  onChange={(v: SortOrder) => useDiscoverFilters.getState().set({ sort: v })}
                  options={SORTS.map((s) => ({ value: s, label: t(`discover.sort.${s}`) }))}
                />
              </div>
            </Tooltip>
            <div className="flex shrink-0 items-center">
              {!cfAvailable && !sys.isPending && (
                <Tooltip content={t("discover.cf_disabled")}>
                  <Link
                    to="/settings"
                    search={{ tab: "downloads" }}
                    aria-label={t("discover.cf_disabled")}
                    className="grid h-8 w-8 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text"
                  >
                    <Info size={15} />
                  </Link>
                </Tooltip>
              )}
              <Tooltip content={t("discover.source")}>
                <div className="w-[150px]">
                  <Select<Source>
                    size="sm"
                    variant="ghost"
                    value={sourceValue}
                    onChange={(v) => navigate({ search: (s) => ({ ...s, source: v === "modrinth" ? undefined : v }), replace: true })}
                    options={[
                      { value: "modrinth", label: "Modrinth" },
                      { value: "curseforge", label: "CurseForge", disabled: !cfAvailable },
                      ...enabledStores.map((s) => ({
                        value: `store:${s.id}` as Source,
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            {s.icon && <img src={s.icon} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />}
                            {s.name}
                          </span>
                        ),
                      })),
                    ]}
                  />
                </div>
              </Tooltip>
            </div>
          </div>
          <div className="flex h-8 shrink-0 items-center gap-2 px-6 text-meta text-dim">
            {results.data && !curseforgeBlocked && <span>{t("discover.results", { n: total.toLocaleString() })}</span>}
            {results.isFetching && !results.isFetchingNextPage && <Spinner size={11} className="text-brand" />}
          </div>
          {curseforgeBlocked ? (
            <EmptyState
              icon={<Info size={28} />}
              title={t("discover.cf_title")}
              text={t("discover.cf_text")}
              action={
                <Link to="/settings" search={{ tab: "downloads" }} className={ghostLinkCls}>
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

/** Link im Look eines Sekundär-Knopfs (ghost). */
const ghostLinkCls =
  "inline-flex h-8 items-center gap-1.5 rounded-ctl bg-surface2 px-3 text-[13px] font-semibold text-text transition-colors duration-150 hover:bg-surface3";

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
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onReset}>
            {t("discover.reset")}
          </Button>
        }
      />
    );

  return (
    <div ref={ref} className={cn("scroll min-h-0 flex-1 transition-opacity duration-150", placeholder && "opacity-60")}>
      <div className="relative mx-4" style={{ height: v.getTotalSize() }}>
        {items.map((it) => {
          const hit = hits[it.index];
          return (
            <div key={hit ? hit.id : `s${it.index}`} className="absolute inset-x-0" style={{ top: it.start, height: CARD_H }}>
              {!hit && nextError ? (
                <div className="flex h-full items-center justify-center gap-3 text-[13px] text-muted">
                  {t("discover.next_error")}
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={fetchNext}>
                    {t("common.retry")}
                  </Button>
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
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-6">
      {inst ? <InstanceBadge instance={inst} size={22} /> : <Skeleton className="h-[22px] w-[22px] rounded-ctl" />}
      <div className="min-w-0 flex-1 truncate text-[13px] text-muted">
        {isPending ? (
          t("common.loading")
        ) : inst ? (
          <>
            {t("discover.target_prefix")} <b className="font-semibold text-text">{inst.name}</b>
            <span className="ml-2 text-meta text-dim">{`${inst.mc_version} · ${formatLoader(inst.loader)}`}</span>
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
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-semibold text-muted transition-colors duration-150 hover:bg-white/[.06] hover:text-text"
        >
          <ArrowLeft size={14} />
          {t("discover.back_to_instance")}
        </Link>
      )}
      <IconButton
        label={t("discover.target_clear")}
        tip
        variant="ghost"
        size="sm"
        onClick={() => navigate({ search: (s) => ({ ...s, instance: undefined }), replace: true })}
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}

/** Einklappbare Filtergruppe ohne Rahmen: ruhige Überschrift, Inhalt darunter. */
function FilterGroup({
  id,
  title,
  children,
  right,
  count,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  /** Anzahl aktiver Filter der Gruppe */
  count?: number;
}) {
  const collapsed = useFilterGroups((s) => !!s.collapsed[id]);
  const toggle = useFilterGroups((s) => s.toggle);
  return (
    <section className="flex flex-col gap-0.5 pb-3">
      <div className="flex h-8 items-center gap-1">
        <button aria-expanded={!collapsed} onClick={() => toggle(id)} className="group flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-ctl px-2 text-left">
          <ChevronDown size={13} className={cn("shrink-0 text-dim transition-transform duration-150 group-hover:text-text", collapsed && "-rotate-90")} />
          <span className="truncate text-[12.5px] font-semibold text-muted group-hover:text-text">{title}</span>
          {!!count && <span className="text-caption text-dim">{count}</span>}
        </button>
        {!collapsed && right}
      </div>
      {!collapsed && children}
    </section>
  );
}

/** Kompakte Auswahlzeile ohne Kästchen: ausgewählt = hellere Schrift + Fläche + Haken rechts. */
function CheckRow({ on, label, onClick, radio }: { on: boolean; label: React.ReactNode; onClick: () => void; radio?: boolean }) {
  return (
    <button
      role={radio ? "radio" : "checkbox"}
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-2 rounded-ctl pl-[26px] pr-2 text-left text-[13px] transition-colors duration-100",
        on ? "bg-white/[.06] text-text" : "text-muted hover:bg-white/[.04] hover:text-text",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {on && <Check size={13} strokeWidth={2.5} className="shrink-0 text-brand" />}
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
    <aside className="scroll flex w-[220px] shrink-0 flex-col px-3 pb-6 pt-3">
      <div className="flex h-9 shrink-0 items-center gap-2 pl-2">
        <span className="flex-1 text-section text-text">{t("discover.filters")}</span>
        {active && (
          <IconButton label={t("discover.reset")} tip variant="ghost" size="sm" onClick={() => f.reset()}>
            <RotateCcw size={14} />
          </IconButton>
        )}
      </div>
      <FilterGroup id="version" title={t("discover.filter.version")} count={f.version ? 1 : 0}>
        <div className="pl-[18px]">
          <Select
            size="sm"
            variant="ghost"
            value={f.version ?? ALL}
            onChange={(v) => f.set({ version: v === ALL ? null : v })}
            options={[{ value: ALL, label: t("discover.filter.all_versions") }, ...versions.map((v) => ({ value: v, label: v }))]}
          />
        </div>
      </FilterGroup>
      {loaderApplies && (
        <FilterGroup id="loader" title={t("discover.filter.loader")} count={f.loader ? 1 : 0}>
          <div className="flex flex-col gap-px" role="radiogroup" aria-label={t("discover.filter.loader")}>
            {LOADERS.map((l) => (
              <CheckRow key={l} radio on={f.loader === l} label={formatLoader({ kind: l, version: null })} onClick={() => f.set({ loader: f.loader === l ? null : l })} />
            ))}
          </div>
        </FilterGroup>
      )}
      <FilterGroup
        id="categories"
        title={t("discover.filter.categories")}
        count={f.categories.length}
        right={
          f.categories.length > 0 && (
            <button
              className="h-7 shrink-0 rounded-ctl px-2 text-caption font-medium text-dim transition-colors hover:bg-white/[.06] hover:text-text"
              onClick={() => f.set({ categories: [] })}
            >
              {t("discover.filter.clear")}
            </button>
          )
        }
      >
        {cats.isPending ? (
          <div className="flex flex-col gap-2 py-1 pl-[26px]">
            {[70, 90, 60, 84, 66, 78].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : cats.isError ? (
          <button className="pl-[26px] pr-2 text-left text-[12px] text-dim hover:text-text" onClick={() => cats.refetch()}>
            {t("discover.filter.cats_error")}
          </button>
        ) : (
          <div className="flex flex-col gap-px">
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
