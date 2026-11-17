// OWNER: Frontend-Agent A. Bibliothek: Filter (Alle/Eigene/Modpacks), Suche, Sortierung, Gruppierung,
// Raster kompakter Instanz-Karten.
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, PackageOpen, Plus } from "lucide-react";
import { useInstances } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { loaderNames } from "@/lib/format";
import { Button, EmptyState, ErrorState, SearchInput, Select, cn } from "@/components/ui";
import { InstanceCard, InstanceCardSkeleton } from "@/components/instance/InstanceCard";
import { openNewInstance, useInstanceActions } from "@/components/instance/actions";
import { Logo3D } from "@/components/Logo3D";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";

type SortKey = "recent" | "name" | "created" | "playtime";
const SORTS: SortKey[] = ["recent", "name", "created", "playtime"];
type GroupKey = "group" | "loader" | "version" | "none";
const GROUPS: GroupKey[] = ["group", "loader", "version", "none"];
type FilterKey = "all" | "custom" | "modpacks";
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

/** Raster: bei 1280 px Fensterbreite 5–6 Karten je Reihe. */
export const gridCls = "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3";

export function InstancesPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInstances();
  const { open } = useInstanceActions();
  const [query, setQuery] = useState("");
  const [filter, setFilterState] = useState<FilterKey>(() => load("vl.inst.filter", "all"));
  const [sort, setSortState] = useState<SortKey>(() => load("vl.inst.sort", "recent"));
  const [groupBy, setGroupByState] = useState<GroupKey>(() => load("vl.inst.groupby", "group"));
  const [collapsed, setCollapsed] = useState<string[]>(() => load("vl.inst.collapsed", []));
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
      groupBy === "group" ? (i.group ?? "") : groupBy === "loader" ? loaderNames[i.loader.kind] : groupBy === "version" ? i.mc_version : "";
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
      <div className="flex flex-col gap-4 px-6 pb-10 pt-5">
        <header className="flex items-center gap-3">
          <h1 className="display min-w-0 flex-1 truncate text-[22px]">{t("nav.instances")}</h1>
          <Button icon={<PackageOpen size={15} />} onClick={() => openImport()}>
            {t("home.action.import")}
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openNewInstance}>
            {t("inst.new")}
          </Button>
        </header>

        {total > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-line bg-surface p-0.5" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "flex h-[30px] items-center gap-1.5 px-3 text-[13px] font-semibold transition-colors duration-100",
                    filter === f ? "bg-surface3 text-white" : "text-muted hover:text-white",
                  )}
                >
                  {t(`instances.filter.${f}`)}
                  <span className="text-[12px] font-medium text-dim">{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="w-[240px] min-w-[160px]">
              <SearchInput value={query} onChange={setQuery} placeholder={t("instances.search")} className="[&_input]:h-9" />
            </div>
            <div className="flex-1" />
            <div className="w-[168px] [&_button]:h-9">
              <Select<SortKey> size="sm" value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s, label: t(`instances.sort.${s}`) }))} />
            </div>
            <div className="w-[168px] [&_button]:h-9">
              <Select<GroupKey>
                size="sm"
                value={groupBy}
                onChange={setGroupBy}
                options={GROUPS.map((g) => ({ value: g, label: t(`instances.groupby.${g}`) }))}
              />
            </div>
          </div>
        )}

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
            className="mt-6 border border-dashed border-line2 bg-surface py-14"
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
          <EmptyState title={t("instances.no_match")} text={q ? t("instances.no_match.text", { q: query }) : undefined} />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map(([g, list]) => {
              const key = `${groupBy}:${g}`;
              const isCollapsed = showHeaders && !q && collapsed.includes(key);
              return (
                <section key={key} className="flex flex-col gap-2.5">
                  {showHeaders && (
                    <button onClick={() => toggle(key)} aria-expanded={!isCollapsed} className="group flex items-center gap-2 text-left">
                      <ChevronDown size={15} className={cn("text-dim transition-transform duration-150 group-hover:text-white", isCollapsed && "-rotate-90")} />
                      <span className="text-[14px] font-semibold text-white">{g || t(`instances.ungrouped.${groupBy}`)}</span>
                      <span className="text-[12px] text-dim">{list.length}</span>
                    </button>
                  )}
                  {!isCollapsed && (
                    <div className={gridCls}>
                      {list.map((i) => (
                        <InstanceCard key={i.id} instance={i} onOpen={onOpen} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
