// Startansicht von Entdecken (ohne Suchbegriff): kuratierte Abschnitte wie bei Modrinth/CurseForge –
// Im Trend, Beliebt (Rangliste), Kategorien als Kacheln, Neu erschienen. Filter (Version/Loader) gelten mit.
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Skeleton, cn, pageWrap } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { qk } from "@/lib/queries";
import type { Category, Instance, ProjectHit, ProjectType, SearchQuery, SortOrder, Source } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { prettyLoader } from "@/components/content/Pill";
import { CategoryIcon, catIconKey, catLabel } from "./categoryIcons";
import { InstallMenu } from "./InstallMenu";
import { ResultTile, TILE_H, TILE_MIN_W, TileSkeleton } from "./ResultCard";
import { TRENDING_DAYS, trendingSince } from "./store";

const GAP = 12;

type Base = Omit<SearchQuery, "offset" | "limit" | "sort" | "created_after" | "query">;

function useSection(base: Base, sort: SortOrder, limit: number, createdAfter?: number) {
  const q = { ...base, query: "", sort, offset: 0, limit, created_after: createdAfter ?? null };
  return useQuery({
    queryKey: ["discover-browse", q],
    queryFn: () => api.contentSearch(q),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** Anzahl Kacheln pro Reihe aus der Breite des Containers. */
function useColumns(min: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width + GAP) / (min + GAP)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, cols] as const;
}

function SectionHead({ title, hint, onAll }: { title: string; hint?: string; onAll?: () => void }) {
  const t = useT();
  return (
    <div className="mb-3 flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] font-bold leading-tight tracking-[-0.01em] text-text">{title}</h2>
        {hint && <p className="mt-0.5 truncate text-[12.5px] text-dim">{hint}</p>}
      </div>
      {onAll && (
        <button
          onClick={onAll}
          className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-white/[.06] hover:text-text"
        >
          {t("discover.browse.all")}
          <ArrowRight size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex h-24 items-center justify-center gap-3 rounded-card bg-surface text-[13px] text-muted">
      {t("discover.browse.error")}
      <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

interface Common {
  target: Instance | null;
  installed: Set<string>;
  instances: Instance[];
  onOpen: (h: ProjectHit) => void;
}

function TileRow({ hits, pending, cols, ...c }: Common & { hits: ProjectHit[] | undefined; pending: boolean; cols: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {pending || !hits
        ? Array.from({ length: cols }, (_, i) => (
            <div key={i} style={{ height: TILE_H }}>
              <TileSkeleton />
            </div>
          ))
        : hits.slice(0, cols).map((h) => (
            <div key={h.id} style={{ height: TILE_H }} className="animate-fade-in">
              <ResultTile hit={h} target={c.target} installed={c.installed.has(h.id)} instances={c.instances} onOpen={c.onOpen} />
            </div>
          ))}
    </div>
  );
}

/** Rangliste: kompakte Zeilen mit Platz, Icon, Name, Downloads und Installieren. */
function RankList({ hits, pending, ...c }: Common & { hits: ProjectHit[] | undefined; pending: boolean }) {
  const t = useT();
  return (
    <ol className="grid grid-cols-1 gap-x-6 gap-y-0.5 @min-[760px]:grid-cols-2">
      {pending || !hits
        ? Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex h-[64px] items-center gap-3 px-2">
              <Skeleton className="h-4 w-5" />
              <Skeleton className="h-11 w-11 shrink-0" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </li>
          ))
        : hits.slice(0, 8).map((h, i) => (
            <li key={h.id} className="animate-fade-in">
              <div
                role="link"
                tabIndex={0}
                onClick={() => c.onOpen(h)}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && c.onOpen(h)}
                className="group flex h-[64px] cursor-pointer items-center gap-3 rounded-card px-2 transition-colors duration-100 hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
              >
                <span className={cn("w-5 shrink-0 text-right text-[13px] font-bold tabular-nums", i < 3 ? "text-text" : "text-dim")}>{i + 1}</span>
                <ProjectIcon src={h.icon_url} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold leading-tight text-text">{h.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-dim">
                    <span className="truncate">{t("discover.by", { author: h.author })}</span>
                    <span>·</span>
                    <Download size={11} className="shrink-0" />
                    <span className="shrink-0 tabular-nums">{formatCount(h.downloads)}</span>
                  </div>
                </div>
                <span className="shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
                  <InstallMenu project={h} target={c.target} installed={c.installed.has(h.id)} />
                </span>
              </div>
            </li>
          ))}
    </ol>
  );
}

function CategoryTiles({ cats, pending, onPick }: { cats: Category[] | undefined; pending: boolean; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
      {pending || !cats
        ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-[52px] rounded-card" />)
        : cats.slice(0, 24).map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className="group flex h-[52px] items-center gap-3 rounded-card bg-surface px-3.5 text-left transition-colors duration-100 hover:bg-surface2 focus-visible:bg-surface2"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-white/[.05] text-muted transition-colors duration-100 group-hover:bg-brand/15 group-hover:text-brand">
                <CategoryIcon id={catIconKey(c)} size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">{catLabel(c)}</span>
            </button>
          ))}
    </div>
  );
}

export function Browse({
  source,
  type,
  version,
  loader,
  onShowAll,
  onCategory,
  footer,
  ...c
}: Common & {
  source: Source;
  type: ProjectType;
  version: string | null;
  loader: SearchQuery["loader"];
  onShowAll: (sort: SortOrder | "trending") => void;
  onCategory: (id: string) => void;
  footer?: ReactNode;
}) {
  const t = useT();
  const base: Base = { source, project_type: type, game_version: version, loader, categories: [] };
  const [ref, cols] = useColumns(TILE_MIN_W);
  const isModrinth = source === "modrinth";
  const trending = useSection(base, "follows", 12, isModrinth ? trendingSince() : undefined);
  const popular = useSection(base, "downloads", 8);
  const fresh = useSection(base, "newest", 12);
  const cats = useQuery({
    queryKey: qk.categories(source, type),
    queryFn: () => api.contentCategories(source, type),
    staleTime: 60 * 60_000,
  });
  const kind = t(`discover.tab.${type}`);
  const scope = [version, loader ? prettyLoader(loader) : null].filter(Boolean).join(" · ");

  return (
    <div className="scroll min-h-0 flex-1">
      <div ref={ref} className={cn("@container flex flex-col gap-9 pb-12 pt-2", pageWrap)}>
        <section>
          <SectionHead
            title={t("discover.browse.trending")}
            hint={isModrinth ? t("discover.browse.trending_hint", { days: TRENDING_DAYS }) : t("discover.browse.trending_hint_cf")}
            onAll={() => onShowAll(isModrinth ? "trending" : "follows")}
          />
          {trending.isError ? <SectionError onRetry={() => trending.refetch()} /> : <TileRow hits={trending.data?.hits} pending={trending.isPending} cols={cols} {...c} />}
        </section>

        <section>
          <SectionHead title={t("discover.browse.popular", { kind })} hint={scope ? t("discover.browse.for", { scope }) : t("discover.browse.popular_hint")} onAll={() => onShowAll("downloads")} />
          {popular.isError ? <SectionError onRetry={() => popular.refetch()} /> : <RankList hits={popular.data?.hits} pending={popular.isPending} {...c} />}
        </section>

        {(cats.isPending || (cats.data?.length ?? 0) > 0) && (
          <section>
            <SectionHead title={t("discover.browse.categories")} hint={t("discover.browse.categories_hint")} />
            <CategoryTiles cats={cats.data} pending={cats.isPending} onPick={onCategory} />
          </section>
        )}

        <section>
          <SectionHead title={t("discover.browse.new")} hint={t("discover.browse.new_hint")} onAll={() => onShowAll("newest")} />
          {fresh.isError ? <SectionError onRetry={() => fresh.refetch()} /> : <TileRow hits={fresh.data?.hits} pending={fresh.isPending} cols={cols} {...c} />}
        </section>
        {footer}
      </div>
    </div>
  );
}
