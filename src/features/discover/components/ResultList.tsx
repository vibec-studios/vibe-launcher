import { useVirtualizer } from "@tanstack/react-virtual";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Instance, ProjectHit } from "@/lib/types";
import { GAP, GRID_GAP } from "../constants";
import { ROW_H, ResultRow, ResultTile, RowSkeleton, TILE_H, TILE_MIN_W, TileSkeleton } from "../ResultCard";
import { scrollOffsets, type ViewMode } from "../store";

/** Spaltenzahl des Rasters aus der Breite des Scrollbereichs (abzüglich Rand). */
export function useGridCols(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width - 48 + GRID_GAP) / (TILE_MIN_W + GRID_GAP)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return cols;
}

export function ResultList({
  view,
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
  view: ViewMode;
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
  target: Instance | null;
  installed: Set<string>;
  instances: Instance[];
  onOpen: (h: ProjectHit) => void;
  onReset: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const grid = view === "grid";
  const cols = useGridCols(ref, grid);
  const per = grid ? cols : 1;
  // Platzhalter am Ende: Skelette, solange es weitere Seiten gibt
  const tail = nextError ? 1 : hasNext ? (grid ? 1 : 3) : 0;
  const itemCount = status === "pending" ? (grid ? cols * 3 : 7) : hits.length;
  const rows = Math.ceil(itemCount / per) + (status === "pending" ? 0 : tail);
  const rowH = grid ? TILE_H + GRID_GAP : ROW_H + GAP;
  const v = useVirtualizer({
    count: rows,
    getScrollElement: () => ref.current,
    estimateSize: () => rowH,
    overscan: grid ? 3 : 6,
    paddingStart: 2,
    paddingEnd: 20,
    initialOffset: () => scrollOffsets.get(keyStr) ?? 0,
    onChange: (inst) => {
      scrollOffsets.set(keyStr, inst.scrollOffset ?? 0);
    },
  });
  const items = v.getVirtualItems();
  const lastRow = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (status === "success" && hasNext && !fetchingNext && !nextError && (lastRow + 1) * per >= hits.length - 4 * per) fetchNext();
  }, [lastRow, per, hits.length, hasNext, fetchingNext, nextError, status, fetchNext]);

  if (status === "error" && !hits.length) return <ErrorState error={error} onRetry={retry} className="flex-1" />;
  if (status === "success" && !hits.length)
    return (
      <EmptyState
        icon={<img src="/logo-seal.png" alt="" width={104} height={104} className="h-[104px] w-[104px] object-contain" draggable={false} />}
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

  const cell = (idx: number) => {
    const hit = hits[idx];
    if (status === "pending" || !hit) return grid ? <TileSkeleton /> : <RowSkeleton />;
    const Card = grid ? ResultTile : ResultRow;
    return <Card hit={hit} target={target} installed={installed.has(hit.id)} instances={instances} onOpen={onOpen} />;
  };

  return (
    <div ref={ref} className={cn("scroll min-h-0 flex-1 transition-opacity duration-150", placeholder && "opacity-60")}>
      <div className={cn("relative", grid ? "mx-6" : "mx-3")} style={{ height: v.getTotalSize() }}>
        {items.map((it) => {
          const first = it.index * per;
          const isTail = status !== "pending" && first >= hits.length;
          return (
            <div key={it.index} className="absolute inset-x-0" style={{ top: it.start, height: grid ? TILE_H : ROW_H }}>
              {isTail && nextError ? (
                <div className="flex h-full items-center justify-center gap-3 text-[13px] text-muted">
                  {t("discover.next_error")}
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={fetchNext}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : grid ? (
                <div className="grid h-full gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {Array.from({ length: per }, (_, k) => first + k)
                    .filter((i) => isTail || status === "pending" || i < hits.length)
                    .map((i) => (
                      <div key={hits[i]?.id ?? `s${i}`} className="min-w-0">
                        {cell(i)}
                      </div>
                    ))}
                </div>
              ) : (
                cell(first)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
