import type { Virtualizer } from "@tanstack/react-virtual";
import type { Screenshot } from "@/lib/types";
import { Skeleton } from "@/components/ui";
import { GAP, type Row } from "../layout";
import { Tile } from "./ShotTile";

export function ShotsSkeleton({ cols }: { cols: number }) {
  return (
    // Platzhalter wie das echte Raster: Gruppen-Überschrift + Kacheln
    <div className="flex flex-col" aria-busy>
      <div className="flex h-[40px] items-end pb-2.5">
        <Skeleton className="h-3.5 w-24" />
      </div>
      <div className="grid" style={{ gap: GAP, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols * 2 }, (_, n) => (
          <Skeleton key={n} className="aspect-video rounded-card" />
        ))}
      </div>
    </div>
  );
}

export function ShotsGrid({
  rows,
  v,
  cols,
  tileH,
  names,
  onOpen,
  onDelete,
  onShare,
}: {
  rows: Row[];
  v: Virtualizer<HTMLDivElement, Element>;
  cols: number;
  tileH: number;
  names: Map<string, string>;
  onOpen: (s: Screenshot) => void;
  onDelete: (s: Screenshot) => void;
  onShare?: (s: Screenshot) => void;
}) {
  return (
    <div className="relative w-full" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((vr) => {
        const row = rows[vr.index];
        return (
          <div key={vr.key} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${vr.start}px)`, height: vr.size }}>
            {row.kind === "head" ? (
              <div className="flex h-full items-end gap-2 pb-2.5">
                <h2 className="text-section text-text">{row.label}</h2>
                <span className="text-meta tabular-nums text-dim">{row.count}</span>
              </div>
            ) : (
              <div className="flex" style={{ gap: GAP }}>
                {row.items.map((s) => (
                  <Tile
                    key={s.path}
                    shot={s}
                    instanceName={names.get(s.instance_id) ?? s.instance_id}
                    height={tileH}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    onShare={onShare}
                  />
                ))}
                {Array.from({ length: cols - row.items.length }, (_, n) => (
                  <div key={n} className="min-w-0 flex-1" />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
