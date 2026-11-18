// CurseForge-Dateien ohne Drittanbieter-Freigabe: müssen manuell geladen und in den Ordner gelegt werden.
// Wird in der Hinweiszeile der Instanzseite als Popover gezeigt (früher: Banner im Inhalte-Tab).
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import { Button, IconButton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { kindFolder } from "@/components/content/util";

export function useMissingDownloads(instanceId: string) {
  // Schlüssel unter ["content", id] -> EventBridge invalidiert bei content://changed
  return useQuery({ queryKey: ["content", instanceId, "missing"], queryFn: () => api.contentMissing(instanceId), staleTime: 60_000, retry: 0 });
}

export function MissingPanel({ instanceId, onDismissed }: { instanceId: string; onDismissed?: () => void }) {
  const t = useT();
  const q = useMissingDownloads(instanceId);
  const items = q.data ?? [];
  // Ordner der meisten fehlenden Dateien (fast immer mods/)
  const kind = items[0]?.kind ?? "mod";

  const recheck = () => queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
  const dismiss = () =>
    api
      .contentMissingDismiss(instanceId)
      .then(() => {
        queryClient.setQueryData(["content", instanceId, "missing"], []);
        onDismissed?.();
      })
      .catch((e) => toast.error(e));

  return (
    <div>
      <div className="border-b border-line px-4 py-3">
        <div className="text-[13.5px] font-semibold text-text">{t("missing.title", { n: items.length })}</div>
        <div className="mt-0.5 text-meta text-muted">{t("missing.text")}</div>
      </div>
      <div className="scroll max-h-[240px] px-4 py-1">
        {items.map((m) => (
          <div key={m.file_name} className="flex h-9 items-center gap-3 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-text" title={m.file_name}>
              {m.project_name}
            </span>
            <a href={m.page_url} className="inline-flex shrink-0 items-center gap-1.5 rounded-ctl text-[13px] font-semibold text-brand hover:underline">
              {t("missing.download")}
              <ExternalLink size={11} />
            </a>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-line px-3 py-2">
        <IconButton
          label={t("common.open_folder")}
          tip
          tipSide="top"
          variant="ghost"
          size="sm"
          onClick={() => api.instanceOpenFolder(instanceId, kindFolder[kind]).catch((e) => toast.error(e))}
        >
          <FolderOpen size={15} />
        </IconButton>
        <IconButton label={t("missing.recheck")} tip tipSide="top" variant="ghost" size="sm" disabled={q.isFetching} onClick={recheck}>
          {q.isFetching ? <Spinner size={12} /> : <RefreshCw size={15} />}
        </IconButton>
        <div className="flex-1" />
        <Button size="sm" variant="subtle" onClick={dismiss}>
          {t("missing.dismiss")}
        </Button>
      </div>
    </div>
  );
}
