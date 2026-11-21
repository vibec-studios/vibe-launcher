// Entdecken: Modrinth/CurseForge durchsuchen. Suchbegriff/Typ/Quelle/Ziel-Instanz stehen in den Search-Params,
// übrige Filter im Store (bleiben beim Zurücknavigieren erhalten). Ohne Suchbegriff/Sortierung/Kategorie eine
// kuratierte Startansicht (Browse), sonst Ergebnisse als Liste oder Raster – virtualisiert + Endlos-Scrollen.
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LinkHint } from "@/features/mrlinks/LinkHint";
import { Button, EmptyState, PageToolbar, Segmented, SearchInput } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk, useSystemInfo, useJavaInstances } from "@/lib/queries";
import type { ProjectHit, ProjectType, SearchQuery, Source } from "@/lib/types";
import { compatibility, contentKindOf } from "@/components/content/util";
import { useSimple } from "@/lib/mode";
import { useExpert } from "@/lib/simple-mode";
import { byRecent } from "@/features/home/data";
import { openNewGame } from "@/components/instance/actions";
import { Browse } from "./Browse";
import { ServerDiscover } from "./server/ServerDiscover";
import { DiscoverProjectOverlay, useProjectOverlayNav } from "./ProjectOverlay";
import { trendingSince, useDiscoverFilters, useDiscoverView, viewFor } from "./store";
import { PAGE, ghostLinkCls, route } from "./constants";
import { FilterSidebar } from "./components/FilterSidebar";
import { ResultList } from "./components/ResultList";
import { ResultsBar } from "./components/ResultsBar";
import { SourcePicker } from "./components/SourcePicker";
import { SimpleTargetBar, TargetBanner } from "./components/TargetBars";


export function DiscoverPage() {
  const server = route.useSearch({ select: (s) => s.server });
  return server ? <ServerDiscover serverKey={server} /> : <InstanceDiscover />;
}

function InstanceDiscover() {
  const t = useT();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  // Simple-Modus: nur Modrinth, nur Kategorie + Suche, Installieren direkt ins gewählte Spiel, Unpassendes ausgeblendet
  const simple = useSimple();
  const sys = useSystemInfo();
  const cfAvailable = !!sys.data?.curseforge_available;
  const customStores = useExpert("custom-stores");
  const apiKeys = useExpert("api-keys");
  const stores = useQuery({ queryKey: ["stores"], queryFn: api.storesList, staleTime: 5 * 60_000 });
  const enabledStores = (stores.data ?? []).filter((s) => customStores && s.enabled && !s.error);
  const storeSource = search.source?.startsWith("store:") && enabledStores.some((s) => `store:${s.id}` === search.source) ? search.source : null;
  const source: Source = storeSource ?? (search.source === "curseforge" && cfAvailable ? "curseforge" : "modrinth");
  const instances = useJavaInstances();
  const target = useMemo(() => (search.instance ? (instances.data?.find((i) => i.id === search.instance) ?? null) : null), [instances.data, search.instance]);
  const rawType: ProjectType = search.type ?? "mod";
  const type: ProjectType = rawType;
  const effectiveType: ProjectType = target && type === "modpack" ? "mod" : type;

  // Simple: ohne gewähltes Spiel automatisch das zuletzt gespielte passende nehmen (Modpacks brauchen keins)
  const simpleTargets = useMemo(
    () => byRecent(instances.data ?? []).filter((i) => type !== "mod" || i.loader.kind !== "vanilla"),
    [instances.data, type],
  );
  useEffect(() => {
    if (!simple || type === "modpack" || !instances.data) return;
    const ok = target && simpleTargets.some((i) => i.id === target.id);
    if (ok) return;
    const pick = simpleTargets[0];
    if (pick ? pick.id !== search.instance : !!search.instance) navigate({ search: (s) => ({ ...s, instance: pick?.id }), replace: true });
  }, [simple, type, instances.data, target, simpleTargets, search.instance, navigate]);
  const simpleNoTarget = simple && type !== "modpack" && !!instances.data && simpleTargets.length === 0;

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
    created_after: filters.trending && source === "modrinth" ? trendingSince() : null,
  };
  const queryKeyStr = JSON.stringify(query);
  const curseforgeBlocked = search.source === "curseforge" && !cfAvailable && !sys.isPending;
  // Kuratierte Startansicht, solange nichts gesucht/sortiert/gefiltert wird (Stores: direkt die Liste)
  const browsing =
    !search.q && !text && !filters.categories.length && filters.sort === "relevance" && !filters.trending && (source === "modrinth" || source === "curseforge") && !curseforgeBlocked;
  const catsQ = useQuery({ queryKey: qk.categories(source, effectiveType), queryFn: () => api.contentCategories(source, effectiveType), staleTime: 60 * 60_000 });
  const views = useDiscoverView((s) => s.views);
  const view = viewFor(views, effectiveType);

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
    enabled: !(search.source === "curseforge" && !cfAvailable) && !browsing,
  });
  const hits = useMemo(() => {
    const seen = new Set<string>();
    const out: ProjectHit[] = [];
    for (const p of results.data?.pages ?? []) for (const h of p.hits) if (!seen.has(h.id)) (seen.add(h.id), out.push(h));
    // Simple: Unpassendes ausblenden statt nur markieren
    return simple && target ? out.filter((h) => h.project_type === "modpack" || compatibility(h, target).ok) : out;
  }, [results.data, simple, target]);
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
  // Projekte öffnen sich als Overlay über der Seite (Suche, Filter und Scrollposition bleiben erhalten)
  const overlay = useProjectOverlayNav();
  const openOverlay = overlay.open;
  const onOpen = useCallback((hit: ProjectHit) => openOverlay(hit.source, hit.id), [openOverlay]);

  const setType = (v: ProjectType) => {
    useDiscoverFilters.getState().set({ categories: [] });
    // Simple: Modpacks werden ein neues Spiel – dafür das Ziel-Spiel lösen
    navigate({ search: (s) => ({ ...s, type: v === "mod" ? undefined : v, instance: simple && v === "modpack" ? undefined : s.instance }), replace: true });
  };

  const typeItems = (["mod", "modpack", "resourcepack", "shader", "datapack"] as ProjectType[])
    .filter((v) => simple || !(target && v === "modpack"))
    .map((v) => ({ value: v, label: t(`discover.tab.${v}`) }));

  const sourceValue: Source = storeSource ?? (search.source === "curseforge" ? "curseforge" : "modrinth");

  const sourcePicker = (
    <SourcePicker sourceValue={sourceValue} cfAvailable={cfAvailable} sysPending={sys.isPending} apiKeys={apiKeys} enabledStores={enabledStores} />
  );

  return (
    <div className="relative flex h-full flex-col">
      {search.p && <DiscoverProjectOverlay value={search.p} instanceId={search.instance} />}
      {simple ? (
        type !== "modpack" && !simpleNoTarget && !instances.isError && <SimpleTargetBar target={target} options={simpleTargets} />
      ) : (
        search.instance && <TargetBanner instanceId={search.instance} type={effectiveType} />
      )}
      <div className="flex min-h-0 flex-1">
        <FilterSidebar type={effectiveType} source={source} sourcePicker={sourcePicker} />
        <div data-tour="discover-results" className="flex min-w-0 flex-1 flex-col">
          {/* Eine Werkzeugleiste: Typ · Suche (Sortierung über den Ergebnissen, Quelle in der Filterleiste) */}
          <div className="shrink-0 px-6 pt-4">
            <PageToolbar>
              <div data-tour="discover-types" className="flex">
                <Segmented size="md" value={effectiveType} onChange={setType} items={typeItems} />
              </div>
              <SearchInput
                data-tour="discover-search"
                value={text}
                onChange={setText}
                placeholder={t(`discover.search.${effectiveType}`)}
                className="min-w-[180px] flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape" && text) setText("");
                }}
              />
            </PageToolbar>
          </div>
          <LinkHint text={text} onOpened={() => setText("")} />
          {browsing ? (
            <div className="h-3 shrink-0" />
          ) : (
            <ResultsBar
              total={results.data && !curseforgeBlocked ? total : null}
              fetching={results.isFetching && !results.isFetchingNextPage}
              view={view}
              onView={(v) => useDiscoverView.getState().setView(effectiveType, v)}
              cats={catsQ.data}
              canBrowse={!search.q && (source === "modrinth" || source === "curseforge") && !curseforgeBlocked}
              onBrowse={() => {
                setText("");
                useDiscoverFilters.getState().set({ sort: "relevance", trending: false, categories: [] });
              }}
            />
          )}
          {simpleNoTarget ? (
            <EmptyState
              icon="puzzle"
              title={t("sdisc.no_target.title")}
              text={t("sdisc.no_target.text")}
              action={
                <Button variant="primary" icon={<Plus size={15} />} onClick={() => openNewGame("mods")}>
                  {t("sdisc.no_target.cta")}
                </Button>
              }
            />
          ) : curseforgeBlocked ? (
            <EmptyState
              icon="info"
              title={t("discover.cf_title")}
              text={t("discover.cf_text")}
              action={
                <Link to="/settings" search={{ tab: "downloads" }} className={ghostLinkCls}>
                  {t("discover.cf_settings")}
                </Link>
              }
            />
          ) : browsing ? (
            <Browse
              source={source}
              type={effectiveType}
              version={filters.version}
              loader={loaderApplies ? filters.loader : null}
              target={target}
              installed={installed}
              instances={instanceList}
              onOpen={onOpen}
              onShowAll={(s) => useDiscoverFilters.getState().set(s === "trending" ? { sort: "follows", trending: true } : { sort: s, trending: false })}
              onCategory={(id) => useDiscoverFilters.getState().set({ categories: [id], sort: "downloads" })}
            />
          ) : (
            <ResultList
              key={queryKeyStr + view}
              view={view}
              keyStr={queryKeyStr + view}
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
