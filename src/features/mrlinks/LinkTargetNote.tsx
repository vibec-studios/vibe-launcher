import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Tag } from "lucide-react";
import { Button, Dialog, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import type { ProjectType } from "@/lib/types";
import { mrLinksApi } from "./api";

export function LinkTargetNote({ type, version }: { type: ProjectType; version: string | null }) {
  const t = useT();
  const pack = type === "modpack";
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-card bg-surface px-3.5 py-3 text-[13px]">
      <div className="flex items-center gap-2 text-text">
        <Tag size={14} className="shrink-0 text-dim" />
        <span>
          {t(`mrlink.type.${type}`)}
          {version && <span className="text-muted"> · {t("mrlink.version", { version })}</span>}
        </span>
      </div>
      <div className="flex items-start gap-2 text-muted">
        <ArrowRight size={14} className="mt-0.5 shrink-0 text-dim" />
        <span>{t(pack ? "mrlink.next_pack" : "mrlink.next_instance")}</span>
      </div>
    </div>
  );
}

export function VersionLinkResolver({ versionId, onCancel, render }: { versionId: string; onCancel: () => void; render: (projectId: string) => ReactNode }) {
  const t = useT();
  const q = useQuery({ queryKey: ["link-version-project", versionId], queryFn: () => mrLinksApi.versionProject(versionId), retry: 0, staleTime: 60_000 });
  if (q.data) return <>{render(q.data)}</>;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={t("action.install.title")}
      description={t("action.source_hint")}
      size="sm"
      footer={
        <Button variant="subtle" onClick={onCancel}>
          {t(q.isError ? "common.close" : "common.cancel")}
        </Button>
      }
    >
      {q.isError ? (
        <p className="text-[13px] text-danger">{t("mrlink.version_not_found", { id: versionId })}</p>
      ) : (
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-card" />
          <Skeleton className="h-5 w-48" />
        </div>
      )}
    </Dialog>
  );
}
