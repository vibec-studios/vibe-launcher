// OWNER: Frontend-Agent A. Instanzen als Raster mit Suche, Sortierung und einklappbaren Gruppen.
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, PackageOpen, Plus } from "lucide-react";
import { useInstances } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { Button, EmptyState, ErrorState, SearchInput, Select, cn } from "@/components/ui";
import { InstanceCard, InstanceCardSkeleton } from "@/components/instance/InstanceCard";
import { openNewInstance, useInstanceActions } from "@/components/instance/actions";
import { PixelBlock } from "@/components/instance/InstanceIcon";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";

type SortKey = "recent" | "name" | "created" | "playtime";
const SORTS: SortKey[] = ["recent", "name", "created", "playtime"];

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

export const gridCls = "grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3";

export function InstancesPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInstances();
  const { open } = useInstanceActions();
  const [query, setQuery] = useState("");
  const [sort, setSortState] = useState<SortKey>(() => load("vl.inst.sort", "recent"));
  const [collapsed, setCollapsed] = useState<string[]>(() => load("vl.inst.collapsed", []));
  const q = useDeferredValue(query.trim().toLowerCase());

  const setSort = (s: SortKey) => {
    setSortState(s);
    store("vl.inst.sort", s);
  };
  const toggle = (g: string) => {
    const next = collapsed.includes(g) ? collapsed.filter((x) => x !== g) : [...collapsed, g];
    setCollapsed(next);
    store("vl.inst.collapsed", next);
  };

  const onOpen = useCallback((i: Instance) => open(i), [open]);

  const groups = useMemo(() => {
    const list = (data ?? []).filter(
      (i) => !q || i.name.toLowerCase().includes(q) || i.mc_version.includes(q) || i.loader.kind.includes(q) || (i.group ?? "").toLowerCase().includes(q),
    );
    list.sort(sorters[sort]);
    const map = new Map<string, Instance[]>();
    for (const i of list) {
      const g = i.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(i);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [data, q, sort]);

  const total = data?.length ?? 0;
  const shown = groups.reduce((n, [, l]) => n + l.length, 0);
  const hasGroups = groups.some(([g]) => g !== "");

  return (
    <div className="scroll h-full">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-7 px-8 pb-12 pt-9">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-2.5">{t("instances.eyebrow")}</p>
            <h1 className="display text-[34px]">
              {t("nav.instances")}
              {total > 0 && <span className="ml-3 align-middle font-mono text-[14px] font-normal text-dim">{total}</span>}
            </h1>
          </div>
          <div className="flex items-center gap-2.5">
            <Button icon={<PackageOpen size={14} />} onClick={() => openImport()}>
              {t("home.action.import")}
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={openNewInstance}>
              {t("inst.new")}
            </Button>
          </div>
        </header>

        {total > 0 && (
          <div className="flex items-center gap-3 border-y border-line py-3">
            <div className="w-[340px] min-w-0">
              <SearchInput value={query} onChange={setQuery} placeholder={t("instances.search")} />
            </div>
            <div className="flex-1" />
            <span className="label">{t("instances.sort")}</span>
            <div className="w-[200px] shrink-0">
              <Select<SortKey> value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s, label: t(`instances.sort.${s}`) }))} />
            </div>
          </div>
        )}

        {isError && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading && !data ? (
          <div className={gridCls}>
            {Array.from({ length: 8 }, (_, i) => (
              <InstanceCardSkeleton key={i} />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            className="border border-dashed border-line2 py-20"
            icon={<PixelBlock color="#8b6cff" size={64} />}
            title={t("instances.empty.title")}
            text={t("instances.empty.text")}
            action={
              <div className="flex gap-3">
                <Button variant="primary" icon={<Plus size={15} />} onClick={openNewInstance}>
                  {t("inst.new")}
                </Button>
                <Button icon={<PackageOpen size={14} />} onClick={() => openImport()}>
                  {t("home.action.import")}
                </Button>
              </div>
            }
          />
        ) : shown === 0 ? (
          <EmptyState title={t("instances.no_match")} text={t("instances.no_match.text", { q: query })} />
        ) : (
          <div className="flex flex-col gap-7">
            {groups.map(([g, list]) => {
              const isCollapsed = !q && collapsed.includes(g);
              return (
                <section key={g || "_"} className="flex flex-col gap-3">
                  {hasGroups && (
                    <button onClick={() => toggle(g)} aria-expanded={!isCollapsed} className="group flex items-center gap-3 text-left">
                      <ChevronDown size={14} className={cn("text-dim transition-transform duration-150 group-hover:text-white", isCollapsed && "-rotate-90")} />
                      <span className="label text-muted group-hover:text-white">{g || t("instances.ungrouped")}</span>
                      <span className="font-mono text-[11px] text-dim">{list.length}</span>
                      <span className="h-px flex-1 bg-line" />
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
