// Wiederverwendbarer Installations-Dialog: Instanz wählen (kompatible zuerst), Version (neueste kompatible
// vorausgewählt), Fortschritt im Dialog. Modpacks: Version wählen -> als neue Instanz installieren.
// Öffnen von überall: `openInstall({ project, instanceId?, versionId? })`. Host sitzt in GlobalDropZone.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, FolderPlus, ListPlus, PackagePlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Button, Dialog, Progress, Select, Skeleton, Switch, Tag, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader, formatRelative } from "@/lib/format";
import { qk, useTask, useJavaInstances } from "@/lib/queries";
import type { Instance, ProjectHit, ProjectVersion } from "@/lib/types";
import { InstanceBadge } from "./InstanceBadge";
import { startContentInstall, startManualDownload, startModpackInstall } from "./install";
import { ManualBadge } from "./ManualBadge";
import { ProjectIcon } from "./ProjectIcon";
import { compatibility, contentKindOf, loaderFilterFor, navigateTo, type Compat } from "./util";

export type InstallProject = Pick<ProjectHit, "source" | "id" | "slug" | "title" | "icon_url" | "project_type" | "loaders" | "game_versions" | "author" | "manual_download">;

interface InstallTarget {
  project: InstallProject;
  instanceId?: string | null;
  versionId?: string | null;
}

const useInstallDialog = create<{ target: InstallTarget | null; seq: number }>(() => ({ target: null, seq: 0 }));

export function openInstall(target: InstallTarget) {
  useInstallDialog.setState((s) => ({ target, seq: s.seq + 1 }));
}

export function InstallDialogHost() {
  const target = useInstallDialog((s) => s.target);
  const seq = useInstallDialog((s) => s.seq);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(!!target), [target, seq]);
  if (!target) return null;
  return (
    <InstallDialog
      key={seq}
      target={target}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTimeout(() => useInstallDialog.setState((s) => (s.seq === seq ? { target: null } : s)), 200);
      }}
    />
  );
}

type Phase =
  | { k: "select" }
  | { k: "running"; taskId: string }
  | { k: "done"; instanceId: string }
  | { k: "error"; message: string };

/** Wie der letzte Start lief (manuell: Dateiseite geöffnet bzw. nur vorgemerkt) – für den Abschlusstext. */
const useManualMode = create<{ mode: "open" | "add" | null }>(() => ({ mode: null }));

function reasonText(t: ReturnType<typeof useT>, c: Compat, inst: Instance) {
  if (c.ok) return null;
  if (c.reason === "vanilla") return t("install.incompat.vanilla");
  if (c.reason === "loader") return t("install.incompat.loader", { loader: formatLoader({ kind: inst.loader.kind, version: null }) });
  return t("install.incompat.version", { version: inst.mc_version });
}

function InstallDialog({ target, open, onOpenChange }: { target: InstallTarget; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { project } = target;
  const isPack = project.project_type === "modpack";
  const [phase, setPhase] = useState<Phase>({ k: "select" });
  const openRef = useRef(open);
  openRef.current = open;

  const title = isPack ? t("install.pack_title") : t("install.title");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      footer={<Footer phase={phase} setPhase={setPhase} isPack={isPack} onClose={() => onOpenChange(false)} />}
    >
      <div className="flex items-center gap-3">
        <ProjectIcon src={project.icon_url} size={40} eager />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-text">{project.title}</div>
          <div className="truncate text-meta text-dim">{t("discover.by", { author: project.author })}</div>
        </div>
        <Tag>{t(`discover.type.${project.project_type}`)}</Tag>
      </div>
      {phase.k === "select" &&
        (isPack ? (
          <PackSelect target={target} onStart={(id) => setPhase({ k: "running", taskId: id })} onError={(m) => setPhase({ k: "error", message: m })} isOpen={() => openRef.current} />
        ) : (
          <ContentSelect target={target} onStart={(id) => setPhase({ k: "running", taskId: id })} onError={(m) => setPhase({ k: "error", message: m })} />
        ))}
      {phase.k === "running" && <Running taskId={phase.taskId} isPack={isPack} onDone={(iid) => (isPack ? onOpenChange(false) : setPhase({ k: "done", instanceId: iid }))} onFail={(m) => setPhase({ k: "error", message: m })} />}
      {phase.k === "done" && <DoneNote name={project.title} manual={!!project.manual_download && !isPack} />}
      {phase.k === "error" && (
        <div className="mt-5 flex items-start gap-3 rounded-card bg-danger/[.08] px-4 py-3 animate-fade-in">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text">{t("install.error_title")}</div>
            <div className="selectable mt-1 break-words text-[12.5px] text-muted">{phase.message}</div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DoneNote({ name, manual }: { name: string; manual: boolean }) {
  const t = useT();
  const mode = useManualMode((s) => s.mode);
  const text = manual && mode === "open" ? t("manual.done_inline", { name }) : manual && mode === "add" ? t("manual.added_inline", { name }) : t("install.done_inline", { name });
  return (
    <div className="mt-5 flex items-center gap-3 rounded-card bg-ok/[.08] px-4 py-3 animate-fade-in">
      <CheckCircle2 size={18} className="shrink-0 text-ok" />
      <div className="text-[13px]">{text}</div>
    </div>
  );
}

// Die Auswahl-Komponenten legen ihren "Start"-Knopf über ein Portal-Ziel in den Footer – einfacher:
// Footer liest den aktuellen Start-Handler aus diesem kleinen Store.
const useStartAction = create<{
  run: (() => void) | null;
  disabled: boolean;
  busy: boolean;
  label: string;
  /** Manueller Download: Haupt-Knopf öffnet CurseForge */
  manual?: boolean;
  /** Zweiter Knopf (manuell: „Zur Instanz hinzufügen“) */
  alt?: { label: string; run: () => void } | null;
}>(() => ({
  run: null,
  disabled: true,
  busy: false,
  label: "",
}));

function Footer({ phase, setPhase, isPack, onClose }: { phase: Phase; setPhase: (p: Phase) => void; isPack: boolean; onClose: () => void }) {
  const t = useT();
  const start = useStartAction();
  if (phase.k === "select")
    return (
      <>
        {/* Manuell: drei Knöpfe passen nicht – Schließen über das X */}
        {!start.alt && (
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        )}
        {start.alt && (
          <Tooltip content={<span className="block max-w-[260px] leading-snug">{t("manual.add_tip")}</span>}>
            <Button variant="ghost" disabled={start.disabled || start.busy} onClick={() => start.alt?.run()} icon={<ListPlus size={14} />}>
              {start.alt.label}
            </Button>
          </Tooltip>
        )}
        <Button
          variant="primary"
          disabled={start.disabled}
          loading={start.busy}
          onClick={() => start.run?.()}
          icon={isPack ? <FolderPlus size={14} /> : start.manual ? <ExternalLink size={14} /> : <PackagePlus size={14} />}
        >
          {start.label}
        </Button>
      </>
    );
  if (phase.k === "running")
    return (
      <Button variant="ghost" onClick={onClose}>
        {t("install.background")}
      </Button>
    );
  if (phase.k === "done")
    return (
      <>
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            navigateTo({ to: "/instances/$id", params: { id: phase.instanceId }, search: { tab: "content" } });
          }}
        >
          {t("install.go_instance")}
        </Button>
        <Button variant="primary" onClick={onClose} autoFocus>
          {t("common.done")}
        </Button>
      </>
    );
  return (
    <>
      <Button variant="subtle" onClick={onClose}>
        {t("common.close")}
      </Button>
      <Button variant="ghost" onClick={() => setPhase({ k: "select" })} autoFocus>
        {t("common.back")}
      </Button>
    </>
  );
}

function Running({ taskId, isPack, onDone, onFail }: { taskId: string; isPack: boolean; onDone: (instanceId: string) => void; onFail: (m: string) => void }) {
  const t = useT();
  const task = useTask(taskId);
  const status = task?.status;
  useEffect(() => {
    if (!task) return;
    if (task.status === "done") onDone(task.instance_id ?? "");
    else if (task.status === "failed") onFail(task.error ?? t("install.error_title"));
    else if (task.status === "cancelled") onFail(t("tasks.cancelled"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return (
    <div className="mt-5 flex flex-col gap-2.5 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <span className="label">{isPack ? t("install.running_pack") : t("install.running")}</span>
        <span className="font-mono text-[11px] text-muted">{task?.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
      </div>
      <Progress value={task?.progress ?? null} />
      <div className="h-5 truncate text-[12px] text-dim">{task?.message ?? t("common.loading")}</div>
    </div>
  );
}

function versionOptions(t: ReturnType<typeof useT>, versions: ProjectVersion[]) {
  return versions.map((v) => ({
    value: v.id,
    label: v.name || v.version_number,
    hint: `${v.release_type !== "release" ? t(`versions.type.${v.release_type}`) + " · " : ""}${v.game_versions.slice(-1)[0] ?? ""}`,
  }));
}

function ContentSelect({ target, onStart, onError }: { target: InstallTarget; onStart: (taskId: string) => void; onError: (m: string) => void }) {
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
        <span className="label">{t("install.instance")}</span>
        <div className="scroll -mx-2 flex max-h-[232px] flex-col gap-px px-2" role="radiogroup" aria-label={t("install.instance")}>
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
                  "flex h-[46px] shrink-0 items-center gap-3 rounded-ctl px-2.5 text-left outline-none transition-colors duration-100 focus-visible:bg-white/[.06]",
                  on ? "bg-white/[.07]" : "hover:bg-white/[.04]",
                )}
              >
                <InstanceBadge instance={inst} size={28} />
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-[13.5px] font-medium", compat.ok ? "text-text" : "text-muted")}>{inst.name}</div>
                  <div className="truncate font-mono text-[11px] text-dim">
                    {inst.mc_version} · {formatLoader(inst.loader)}
                  </div>
                </div>
                {!compat.ok && (
                  <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-warn">
                    <AlertTriangle size={12} />
                    {reasonText(t, compat, inst)}
                  </span>
                )}
                <span className="grid w-4 shrink-0 place-items-center text-brand">{on && <Check size={15} strokeWidth={2.5} />}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="label">{t("install.version")}</span>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            {t("install.all_versions")}
            <Switch checked={allVersions} onChange={setAllVersions} label={t("install.all_versions")} />
          </label>
        </div>
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
          <div className="flex min-h-10 items-center rounded-ctl bg-warn/[.08] px-3 py-2 text-[12.5px] text-warn">{t("install.no_versions")}</div>
        ) : (
          <Select value={versionId} onChange={setVersionId} options={versionOptions(t, versions)} />
        )}
        {selected && installed && <div className="text-[12px] text-dim">{t("install.already")}</div>}
        {selected && selectedVersion && <div className="text-[12px] text-dim">{t("install.published", { date: formatRelative(selectedVersion.date) })}</div>}
      </div>
    </div>
  );
}

function PackSelect({ target, onStart, onError, isOpen }: { target: InstallTarget; onStart: (taskId: string) => void; onError: (m: string) => void; isOpen: () => boolean }) {
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
      <div className="flex flex-col gap-2">
        <span className="label">{t("install.version")}</span>
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
        ) : (
          <Select value={versionId} onChange={setVersionId} options={versionOptions(t, versions)} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card bg-white/[.04] px-3.5 py-2.5">
          <div className="label">{t("discover.filter.version")}</div>
          <div className="mt-0.5 truncate font-mono text-[13px] text-text">{v ? v.game_versions.join(", ") || "–" : "–"}</div>
        </div>
        <div className="rounded-card bg-white/[.04] px-3.5 py-2.5">
          <div className="label">{t("discover.filter.loader")}</div>
          <div className="mt-0.5 truncate font-mono text-[13px] capitalize text-text">{v ? v.loaders.join(", ") || "–" : "–"}</div>
        </div>
      </div>
      <p className="text-[12.5px] text-muted">{t("install.pack_hint")}</p>
    </div>
  );
}
