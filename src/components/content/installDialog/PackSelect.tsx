import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Select, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import { startModpackInstall } from "../install";
import type { InstallTarget } from "../installStore";
import { useStartAction } from "./state";
import { versionOptions } from "./utils";

export function PackSelect({ target, onStart, onError, isOpen }: { target: InstallTarget; onStart: (taskId: string) => void; onError: (m: string) => void; isOpen: () => boolean }) {
  const t = useT();
  const { project } = target;
  const versionsQ = useQuery({
    queryKey: qk.versions(project.source, project.id, null, null),
    queryFn: () => api.contentVersions(project.source, project.id, null, null),
  });
  const versions = versionsQ.data ?? [];
  const [versionId, setVersionId] = useState<string | null>(target.versionId ?? null);
  useEffect(() => {
    if (versions.length && (!versionId || !versions.some((v) => v.id === versionId))) setVersionId((versions.find((v) => v.release_type === "release") ?? versions[0]).id);
  }, [versions, versionId]);
  const [busy, setBusy] = useState(false);
  const v = versions.find((x) => x.id === versionId);

  useEffect(() => {
    useStartAction.setState({
      label: t("install.as_new_instance"),
      disabled: !versionId,
      busy,
      run: () => {
        setBusy(true);
        startModpackInstall(project, versionId, isOpen)
          .then(onStart)
          .catch((e) => onError(errorMessage(e)))
          .finally(() => setBusy(false));
      },
    });
  }, [versionId, busy, project, onStart, onError, isOpen, t]);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <h2 className="text-[16px] font-semibold text-text">{t("install.version")}</h2>
        {versionsQ.isPending ? (
          <Skeleton className="h-9 rounded-ctl" />
        ) : versionsQ.isError ? (
          <div className="flex h-10 items-center gap-2 text-[12.5px] text-danger">
            <AlertTriangle size={14} />
            <span className="truncate">{errorMessage(versionsQ.error)}</span>
            <button className="ml-auto text-[13px] font-medium text-muted hover:text-text" onClick={() => versionsQ.refetch()}>
              {t("common.retry")}
            </button>
          </div>
        ) : versions.length === 0 ? (
          <p className="text-[14px] text-warn">{t("install.no_versions")}</p>
        ) : (
          <Select value={versionId} onChange={setVersionId} options={versionOptions(t, versions)} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card bg-white/[.04] px-3.5 py-2.5">
          <div className="label">{t("discover.filter.version")}</div>
          <div className="mt-0.5 break-words text-[14px] text-text">{v ? v.game_versions.join(", ") || "–" : "–"}</div>
        </div>
        <div className="rounded-card bg-white/[.04] px-3.5 py-2.5">
          <div className="label">{t("discover.filter.loader")}</div>
          <div className="mt-0.5 break-words text-[14px] capitalize text-text">{v ? v.loaders.join(", ") || "–" : "–"}</div>
        </div>
      </div>
      <p className="text-[12.5px] text-muted">{t("install.pack_hint")}</p>
    </div>
  );
}
