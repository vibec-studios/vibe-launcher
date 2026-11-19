// OWNER: Frontend-Agent A. Bibliothek: eine Werkzeugleiste (Filter, Suche, Sortierung, Gruppierung, Import, Neu)
// über einem Raster rahmenloser Instanz-Kacheln. Der Seitentitel steht in der Titelleiste.
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, LayoutGrid, List, PackageOpen, Plus, SearchX } from "lucide-react";
import { useInstances } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { loaderNames } from "@/lib/format";
import { useSimple } from "@/lib/mode";
import { Button, EmptyState, ErrorState, IconButton, SearchInput, Select, cn } from "@/components/ui";
import { InstanceCard, InstanceCardSkeleton, InstanceListHeader, InstanceListRow } from "@/components/instance/InstanceCard";
import { openNewInstance, useInstanceActions } from "@/components/instance/actions";
import { Logo3D } from "@/components/Logo3D";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";
import { cachedAppearance } from "@/lib/appearance";

type SortKey = "recent" | "name" | "created" | "playtime";
const SORTS: SortKey[] = ["recent", "name", "created", "playtime"];
type GroupKey = "group" | "loader" | "version" | "none";
const GROUPS: GroupKey[] = ["group", "loader", "version", "none"];
type FilterKey = "all" | "custom" | "modpacks";
type ViewKey = "grid" | "list";
const FILTERS: FilterKey[] = ["all", "custom", "modpacks"];

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* egal */
  }
}

const sorters: Record<SortKey, (a: Instance, b: Instance) => number> = {
  recent: (a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || b.created_at - a.created_at,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  created: (a, b) => b.created_at - a.created_at,
  playtime: (a, b) => b.play_time_secs - a.play_time_secs || a.name.localeCompare(b.name),
};

/** Minecraft-Versionen numerisch absteigend vergleichen ("1.21.10" > "1.21.9"). */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}

/** Raster: bei 1280 px Fensterbreite 6 Kacheln je Reihe; Kachelbreite aus der Einstellung „Instanz-Kacheln“ (--inst-tile). */
export const gridCls = "grid grid-cols-[repeat(auto-fill,minmax(var(--inst-tile),1fr))] gap-x-2 gap-y-2";

export function InstancesPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInstances();
  const { open } = useInstanceActions();
  const [query, setQuery] = useState("");
  const [filter, setFilterState] = useState<FilterKey>(() => load("vl.inst.filter", "all"));
  const [sort, setSortState] = useState<SortKey>(() => load("vl.inst.sort", "recent"));
  const [storedGroupBy, setGroupByState] = useState<GroupKey>(() => load("vl.inst.groupby", "group"));
  // Simple-Modus: keine Gruppierung nach Loader/Version, Auswahl ausgeblendet
  const simple = useSimple();
  const groupBy: GroupKey = simple && (storedGroupBy === "loader" || storedGroupBy === "version") ? "group" : storedGroupBy;
  const [collapsed, setCollapsed] = useState<string[]>(() => load("vl.inst.collapsed", []));
  // Standardansicht aus der Darstellung; eine Umschaltung hier gilt, bis die Einstellung geändert wird
  const [view, setViewState] = useState<ViewKey>(() => load("vl.inst.view", cachedAppearance().library_view));
  const q = useDeferredValue(query.trim().toLowerCase());

  const persist =
    <T,>(key: string, set: (v: T) => void) =>
    (v: T) => {
      set(v);
      store(key, v);
    };
  const setFilter = persist("vl.inst.filter", setFilterState);
  const setSort = persist("vl.inst.sort", setSortState);
  const setGroupBy = persist("vl.inst.groupby", setGroupByState);
  const setView = persist("vl.inst.view", setViewState);
  const toggle = (g: string) => {
    const next = collapsed.includes(g) ? collapsed.filter((x) => x !== g) : [...collapsed, g];
    setCollapsed(next);
    store("vl.inst.collapsed", next);
  };

  const onOpen = useCallback((i: Instance) => open(i), [open]);

  const all = data ?? [];
  const counts = useMemo(() => ({ all: all.length, custom: all.filter((i) => !i.source).length, modpacks: all.filter((i) => i.source).length }), [all]);

  const groups = useMemo(() => {
    const list = all.filter(
      (i) =>
        (filter === "all" || (filter === "modpacks" ? !!i.source : !i.source)) &&
        (!q || i.name.toLowerCase().includes(q) || i.mc_version.includes(q) || i.loader.kind.includes(q) || (i.group ?? "").toLowerCase().includes(q)),
    );
    list.sort(sorters[sort]);
    const keyOf = (i: Instance) =>
      groupBy === "group"
        ? (i.group ?? "")
        : groupBy === "loader"
          ? i.bedrock
            ? "Bedrock"
            : loaderNames[i.loader.kind]
          : groupBy === "version"
            ? i.bedrock
              ? "Bedrock"
              : i.mc_version
            : "";
    const map = new Map<string, Instance[]>();
    for (const i of list) {
      const g = keyOf(i);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(i);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === "" ? -1 : b === "" ? 1 : groupBy === "version" ? cmpVersion(a, b) : a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [all, q, sort, filter, groupBy]);

  const total = all.length;
  const shown = groups.reduce((n, [, l]) => n + l.length, 0);
  const showHeaders = groupBy !== "none" && groups.some(([g]) => g !== "");

  return (
    <div className="scroll h-full">
      <div className="flex flex-col gap-4 px-6 pb-10 pt-4">
        {/* Werkzeugleiste: Filter links, Aktionen rechts. Auf schmalen Fenstern rutschen Suche/Sortierung in eine
            eigene zweite Zeile (statt dass „Importieren“/„Neue Instanz“ irgendwo umbrechen). */}
        <div className="@container">
          <div className="flex flex-wrap items-center gap-2">
            {total > 0 && (
              <>
                <div className="flex shrink-0 gap-0.5 rounded-ctl bg-field p-0.5" role="tablist">
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      role="tab"
                      aria-selected={filter === f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-3 text-[13px] font-semibold transition-colors duration-100",
                        filter === f ? "bg-surface3 text-text" : "text-muted hover:text-text",
                      )}
                    >
                      {t(`instances.filter.${f}`)}
                      <span className="text-[12px] font-medium tabular-nums text-dim">{counts[f]}</span>
                    </button>
                  ))}
                </div>
                <div
                  className={cn(
                    "flex min-w-0 items-center gap-2",
                    simple ? "@max-[960px]:order-last @max-[960px]:w-full" : "@max-[1130px]:order-last @max-[1130px]:w-full",
                  )}
                >
                  <SearchInput value={query} onChange={setQuery} placeholder={t("instances.search")} className="w-[220px] min-w-[150px] @max-[1130px]:flex-1" />
                  <div className="w-[150px] shrink-0">
                    <Select<SortKey>
                      size="sm"
                      variant="ghost"
                      value={sort}
                      onChange={setSort}
                      options={SORTS.map((s) => ({ value: s, label: t(`instances.sort.${s}`) }))}
                    />
                  </div>
                  {!simple && (
                    <div className="w-[150px] shrink-0">
                      <Select<GroupKey>
                        size="sm"
                        variant="ghost"
                        value={groupBy}
                        onChange={setGroupBy}
                        options={GROUPS.map((g) => ({ value: g, label: t(`instances.groupby.${g}`) }))}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="flex-1" />
            {total > 0 && (
              <>
                <div className="flex items-center gap-0.5 rounded-ctl bg-field p-0.5" role="radiogroup" aria-label={t("instances.view")}>
                  <IconButton label={t("instances.view.grid")} tip size="sm" variant="ghost" active={view === "grid"} className="h-7 w-7" role="radio" aria-checked={view === "grid"} onClick={() => setView("grid")}>
                    <LayoutGrid size={14} />
                  </IconButton>
                  <IconButton label={t("instances.view.list")} tip size="sm" variant="ghost" active={view === "list"} className="h-7 w-7" role="radio" aria-checked={view === "list"} onClick={() => setView("list")}>
                    <List size={15} />
                  </IconButton>
                </div>
                {/* Leere Bibliothek: Importieren/Neu stehen groß im Leerzustand, nicht doppelt hier oben */}
                <Button size="sm" variant="subtle" icon={<PackageOpen size={14} />} onClick={() => openImport()}>
                  {t("home.action.import")}
                </Button>
                <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={openNewInstance}>
                  {t("inst.new")}
                </Button>
              </>
            )}
          </div>
        </div>

        {isError && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading && !data ? (
          <div className={gridCls}>
            {Array.from({ length: 12 }, (_, i) => (
              <InstanceCardSkeleton key={i} />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            className="mt-4 rounded-panel bg-surface py-14"
            icon={<Logo3D size={72} speed={0} hoverSpin float={false} interactive={false} />}
            title={t("instances.empty.title")}
            text={t("instances.empty.text")}
            action={
              <div className="flex gap-2">
                <Button variant="primary" icon={<Plus size={16} />} onClick={openNewInstance}>
                  {t("inst.new")}
                </Button>
                <Button icon={<PackageOpen size={15} />} onClick={() => openImport()}>
                  {t("home.action.import")}
                </Button>
              </div>
            }
          />
        ) : shown === 0 ? (
          <EmptyState
            icon={<SearchX size={30} strokeWidth={1.6} />}
            title={t("instances.no_match")}
            text={q ? t("instances.no_match.text", { q: query }) : t(`instances.no_match.filter.${filter}`)}
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                {q ? t("instances.no_match.reset") : t("instances.no_match.show_all")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {view === "list" && (
              <div className="@container -mx-2 -mb-3 border-b border-line">
                <InstanceListHeader />
              </div>
            )}
            {groups.map(([g, list]) => {
              const key = `${groupBy}:${g}`;
              const isCollapsed = showHeaders && !q && collapsed.includes(key);
              return (
                <section key={key} className="flex flex-col gap-1.5">
                  {showHeaders && (
                    <button onClick={() => toggle(key)} aria-expanded={!isCollapsed} className="group flex items-center gap-1.5 self-start px-0.5 text-left">
                      <ChevronDown size={14} className={cn("text-dim transition-transform duration-150 group-hover:text-text", isCollapsed && "-rotate-90")} />
                      <span className="text-[12.5px] font-semibold text-muted group-hover:text-text">{g || t(`instances.ungrouped.${groupBy}`)}</span>
                      <span className="text-[12px] text-dim">{list.length}</span>
                    </button>
                  )}
                  {!isCollapsed &&
                    (view === "list" ? (
                      <div className="@container -mx-2 flex flex-col">
                        {list.map((i) => (
                          <InstanceListRow key={i.id} instance={i} onOpen={onOpen} />
                        ))}
                      </div>
                    ) : (
                      <div className={gridCls}>
                        {list.map((i) => (
                          <InstanceCard key={i.id} instance={i} onOpen={onOpen} />
                        ))}
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
