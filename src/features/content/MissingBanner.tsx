// Banner für CurseForge-Dateien ohne Drittanbieter-Freigabe: müssen manuell geladen und in den Ordner gelegt werden.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { ContentKind } from "@/lib/types";
import { kindFolder } from "@/components/content/util";

export function MissingBanner({ instanceId, kind }: { instanceId: string; kind: ContentKind }) {
  const t = useT();
  // Schlüssel unter ["content", id] -> EventBridge invalidiert bei content://changed
  const q = useQuery({ queryKey: ["content", instanceId, "missing"], queryFn: () => api.contentMissing(instanceId), staleTime: 60_000, retry: 0 });
  const [open, setOpen] = useState(false);
  const items = (q.data ?? []).filter((m) => m.kind === kind);
  if (!items.length) return null;

  const recheck = () => {
    queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
  };
  const dismiss = () =>
    api
      .contentMissingDismiss(instanceId)
      .then(() => queryClient.setQueryData(["content", instanceId, "missing"], []))
      .catch((e) => toast.error(e));

  return (
    <div className="mx-4 mb-3 shrink-0 border border-warn/30 bg-warn/[.04] animate-fade-in">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <AlertTriangle size={16} className="shrink-0 text-warn" />
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-white">{t("missing.title", { n: items.length })}</span>
            <span className="block truncate text-[12px] text-muted">{t("missing.text")}</span>
          </span>
          <ChevronDown size={14} className={cn("shrink-0 text-dim transition-transform duration-150", open && "rotate-180")} />
        </button>
        <Button size="sm" variant="subtle" icon={<FolderOpen size={13} />} onClick={() => api.instanceOpenFolder(instanceId, kindFolder[kind]).catch((e) => toast.error(e))}>
          {t("common.open_folder")}
        </Button>
        <Button size="sm" variant="subtle" icon={<RefreshCw size={13} />} loading={q.isFetching} onClick={recheck}>
          {t("missing.recheck")}
        </Button>
        <Button size="sm" variant="subtle" onClick={dismiss}>
          {t("missing.dismiss")}
        </Button>
      </div>
      {open && (
        <div className="scroll max-h-[180px] border-t border-warn/20 px-4 py-1.5">
          {items.map((m) => (
            <div key={m.file_name} className="flex h-9 items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-white">{m.project_name}</span>
              <span className="hidden min-w-0 max-w-[40%] truncate font-mono text-[11px] text-dim @min-[700px]:block">{m.file_name}</span>
              <a href={m.page_url} className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-brand hover:brightness-125">
                {t("missing.download")}
                <ExternalLink size={11} />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
