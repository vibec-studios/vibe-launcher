import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpCircle, RotateCcw } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatCount } from "@/lib/format";
import { providerOf, refreshTarget, tqk } from "@/features/installtarget/hooks";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import type { AddonHit, AddonSource } from "@/features/servers/addonsApi";
import { AddonRow } from "./AddonRow";
import { useServerInstall, useTargetAddons } from "./parts";
import type { Sort } from "./store";

export function ServerResults({
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
        <EmptyState icon="info" title={t("discover.empty")} text={t("st.empty_text")} className="flex-1" />
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
