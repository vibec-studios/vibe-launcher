import { Cloud, FolderOpen, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { IconButton, PageToolbar, Select, ToolbarMeta, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { ALL, route } from "../layout";
import type { useScreenshots } from "../shots";

export function ShotsToolbar({
  q,
  count,
  instance,
  sharing,
  filterOptions,
  onCloud,
}: {
  q: ReturnType<typeof useScreenshots>;
  count: number;
  instance: string | undefined;
  sharing: boolean;
  filterOptions: { value: string; label: string; hint: string }[];
  onCloud: () => void;
}) {
  const t = useT();
  const nav = route.useNavigate();
  // Werkzeugleiste wie in der Bibliothek: Filter links, Anzahl als Einordnung, Aktionen rechts
  return (
    <div className="shrink-0 px-6 pb-1 pt-4">
      <PageToolbar
        actions={
          <>
            {q.data && count > 0 && <ToolbarMeta>{t(count === 1 ? "shots.count_one" : "shots.count", { n: count.toLocaleString() })}</ToolbarMeta>}
            {instance && (
              <IconButton
                label={t("common.open_folder")}
                tip
                variant="ghost"
                onClick={() => api.instanceOpenFolder(instance, "screenshots").catch((e) => toast.error(e))}
              >
                <FolderOpen size={16} />
              </IconButton>
            )}
            {sharing && (
              <IconButton label={t("shotshare.cloud.title")} tip variant="ghost" onClick={onCloud}>
                <Cloud size={16} />
              </IconButton>
            )}
            <IconButton label={t("shots.reload")} tip variant="ghost" onClick={() => q.refetch()}>
              <RefreshCw size={15} className={cn(q.isFetching && "animate-spin")} />
            </IconButton>
          </>
        }
      >
        <div data-tour="gallery-filter" className="w-[240px] min-w-[160px] shrink">
          <Select<string>
            value={instance ?? ALL}
            onChange={(v) => nav({ search: { instance: v === ALL ? undefined : v }, replace: true })}
            options={filterOptions}
          />
        </div>
      </PageToolbar>
    </div>
  );
}
