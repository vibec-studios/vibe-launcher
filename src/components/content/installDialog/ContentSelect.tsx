import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, FolderPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Select, Skeleton, Switch, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader, formatRelative } from "@/lib/format";
import { qk, useJavaInstances } from "@/lib/queries";
import { InstanceBadge } from "../InstanceBadge";
import { startContentInstall, startManualDownload } from "../install";
import type { InstallTarget } from "../installStore";
import { ManualBadge } from "../ManualBadge";
import { compatibility, contentKindOf, loaderFilterFor, navigateTo } from "../util";
import { useManualMode, useStartAction } from "./state";
import { reasonText, versionOptions } from "./utils";

export function ContentSelect({ target, onStart, onError }: { target: InstallTarget; onStart: (taskId: string) => void; onError: (m: string) => void }) {
  const t = useT();
  const { project } = target;
  const instancesQ = useJavaInstances();
  const kind = contentKindOf(project.project_type);

  const sorted = useMemo(() => {
    const list = (instancesQ.data ?? []).map((inst) => ({ inst, compat: compatibility(project, inst) }));
    return list.sort((a, b) => Number(b.compat.ok) - Number(a.compat.ok) || (b.inst.last_played ?? 0) - (a.inst.last_played ?? 0));
  }, [instancesQ.data, project]);

  const [instanceId, setInstanceId] = useState<string | null>(() => target.instanceId ?? null);
  useEffect(() => {
    if (!instanceId && sorted.length) setInstanceId(sorted[0].inst.id);
  }, [sorted, instanceId]);
  const selected = sorted.find((s) => s.inst.id === instanceId);

  const [allVersions, setAllVersions] = useState(false);
  const gv = selected && !allVersions ? selected.inst.mc_version : null;
  const lf = selected && !allVersions ? loaderFilterFor(project.project_type, selected.inst) : null;
  const versionsQ = useQuery({
    queryKey: qk.versions(project.source, project.id, gv, lf),
    queryFn: () => api.contentVersions(project.source, project.id, gv, lf),
    enabled: !!selected,
    placeholderData: undefined,
  });
  const versions = versionsQ.data ?? [];
  const [versionId, setVersionId] = useState<string | null>(target.versionId ?? null);
  useEffect(() => {
    if (!versions.length) return;
    if (!versionId || !versions.some((v) => v.id === versionId)) setVersionId(versions[0].id);
  }, [versions, versionId]);
  const selectedVersion = versions.find((v) => v.id === versionId);

  // Bereits installiert? (nur für die gewählte Instanz)
  const installedQ = useQuery({
    queryKey: qk.content(instanceId ?? "", kind ?? "mod"),
    queryFn: () => api.contentList(instanceId!, kind!),
    enabled: !!instanceId && !!kind,
  });
  const installed = !!installedQ.data?.some((c) => c.project_id === project.id);

  const [busy, setBusy] = useState(false);
  const manual = !!project.manual_download;
  useEffect(() => {
    const go = (mode: "open" | "add") => {
      if (!selected || !selectedVersion) return;
      setBusy(true);
      useManualMode.setState({ mode });
      startManualDownload(selected.inst.id, project, selectedVersion.id, { silent: true, open: mode === "open" })
        .then(onStart)
        .catch((e) => onError(errorMessage(e)))
        .finally(() => setBusy(false));
    };
    useStartAction.setState({
      label: manual ? t("manual.download") : installed ? t("install.reinstall") : t("common.install"),
      disabled: !selected || !selectedVersion || versionsQ.isFetching || versionsQ.isError,
      busy,
      manual,
      alt: manual ? { label: t("manual.add"), run: () => go("add") } : null,
      run: () => {
        if (!selected || !selectedVersion) return;
        if (manual) return go("open");
        setBusy(true);
        useManualMode.setState({ mode: null });
        startContentInstall(selected.inst.id, project, selectedVersion.id, { silent: true })
          .then(onStart)
          .catch((e) => onError(errorMessage(e)))
          .finally(() => setBusy(false));
      },
    });
  }, [selected, selectedVersion, versionsQ.isFetching, versionsQ.isError, busy, installed, manual, project, onStart, onError, t]);

  if (instancesQ.isPending) {
    return (
      <div className="mt-5 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[46px] rounded-ctl" />
        ))}
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="mt-5 flex flex-col items-center gap-3 rounded-card bg-white/[.03] px-6 py-8 text-center">
        <div className="text-[14.5px] font-semibold text-text">{t("install.no_instances")}</div>
        <p className="max-w-[360px] text-[13px] text-muted">{t("install.no_instances_text")}</p>
        <Button size="sm" variant="primary" icon={<FolderPlus size={14} />} onClick={() => navigateTo({ to: "/instances" })}>
          {t("install.create_instance")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      {manual && (
        <div className="flex items-start gap-2.5 rounded-card bg-warn/[.08] px-3.5 py-3">
          <ManualBadge iconOnly className="mt-px" />
          <div className="min-w-0 text-[12.5px] leading-snug">
            <div className="font-semibold text-text">{t("manual.badge")}</div>
            <div className="mt-0.5 text-muted">{t("manual.tip")}</div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h2 className="text-[16px] font-semibold text-text">{t("install.instance")}</h2>
        <div className="scroll flex max-h-[264px] flex-col gap-2" role="radiogroup" aria-label={t("install.instance")}>
          {sorted.map(({ inst, compat }) => {
            const on = inst.id === instanceId;
            return (
              <button
                key={inst.id}
                role="radio"
                aria-checked={on}
                onClick={() => setInstanceId(inst.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  e.preventDefault();
                  const i = sorted.findIndex((s) => s.inst.id === inst.id);
                  const n = sorted[(i + (e.key === "ArrowDown" ? 1 : sorted.length - 1)) % sorted.length];
                  setInstanceId(n.inst.id);
                  (e.currentTarget.parentElement?.children[sorted.indexOf(n)] as HTMLElement | undefined)?.focus();
                }}
                tabIndex={on ? 0 : -1}
                className={cn(
                  "flex min-h-[58px] shrink-0 flex-wrap items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  on ? "border-accent/60 bg-accent/[.08]" : "border-line bg-surface hover:bg-surface2",
                )}
              >
                <InstanceBadge instance={inst} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[15px] font-semibold text-text">{inst.name}</div>
                  <div className="break-words text-[13px] text-muted">
                    {inst.mc_version} · {formatLoader(inst.loader)}
                  </div>
                </div>
                {!compat.ok && (
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-warn">
                    <AlertTriangle size={14} className="shrink-0" />
                    {reasonText(t, compat, inst)}
                  </span>
                )}
                <span className="grid w-4 shrink-0 place-items-center text-brand">{on && <Check size={15} strokeWidth={2.5} />}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-text">{t("install.version")}</h2>
          <label className="flex items-center gap-2 text-[14px] text-muted">
            {t("install.all_versions")}
            <Switch checked={allVersions} onChange={setAllVersions} label={t("install.all_versions")} />
          </label>
        </div>
        {versionsQ.isPending ? (
          <Skeleton className="h-9 rounded-ctl" />
        ) : versionsQ.isError ? (
          <div role="alert" className="flex items-center gap-2 text-[14px] text-danger">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="min-w-0 break-words">{errorMessage(versionsQ.error)}</span>
            <button className="ml-auto text-[13px] font-medium text-muted hover:text-text" onClick={() => versionsQ.refetch()}>
              {t("common.retry")}
            </button>
          </div>
        ) : versions.length === 0 ? (
          <div className="flex min-h-10 items-center rounded-ctl bg-warn/[.08] px-3 py-2 text-[14px] text-warn">{t("install.no_versions")}</div>
        ) : (
          <Select value={versionId} onChange={setVersionId} options={versionOptions(t, versions)} />
        )}
        {selected && installed && <div className="text-[12px] text-dim">{t("install.already")}</div>}
        {selected && selectedVersion && <div className="text-[12px] text-dim">{t("install.published", { date: formatRelative(selectedVersion.date) })}</div>}
      </div>
    </div>
  );
}
