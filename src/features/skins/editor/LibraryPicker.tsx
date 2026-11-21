import { useQuery } from "@tanstack/react-query";
import { Shirt } from "lucide-react";
import { Dialog, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import type { LibrarySkin } from "@/lib/types";
import { useSkinFront } from "../render";

function PickTile({ skin, onPick }: { skin: LibrarySkin; onPick: () => void }) {
  const t = useT();
  const img = useSkinFront(skin.data_url, skin.variant, 5);
  return (
    <button type="button" onClick={onPick} className="flex flex-col items-stretch overflow-hidden rounded-card bg-surface2 text-left transition-colors hover:bg-surface3">
      <div className="grid h-[104px] place-items-center">
        {img ? <img src={img} alt="" draggable={false} className="h-[90px] w-[45px] [image-rendering:pixelated]" /> : <Skeleton className="h-[90px] w-[45px]" />}
      </div>
      <div className="flex min-w-0 flex-col px-2 pb-2">
        <span className="truncate text-[12.5px] font-semibold text-text" title={skin.name}>
          {skin.name}
        </span>
        <span className="text-[11.5px] text-muted">{skin.variant === "slim" ? t("skins.slim") : t("skins.classic")}</span>
      </div>
    </button>
  );
}

export function LibraryPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (s: LibrarySkin) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["skin-library"], queryFn: api.skinLibraryList, staleTime: Infinity, enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("skined.pick_title")} description={t("skined.pick_text")} size="lg">
      <div className="min-h-[240px] pb-3">
        {q.isPending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[146px]" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState icon={<Shirt size={24} />} title={t("skined.pick_empty")} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
            {q.data.map((s) => (
              <PickTile
                key={s.id}
                skin={s}
                onPick={() => {
                  onPick(s);
                  onOpenChange(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
