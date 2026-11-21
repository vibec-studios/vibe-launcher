// OWNER: Content-Agent. Import-Dialog, Modus "Aus anderem Launcher": erkannte Launcher mit ihren Instanzen,
// Auswahl, eigener Ordner, Import je Instanz (`importExternal`) mit Fortschritt, danach `instanceInstall`.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, FolderOpen, FolderSearch, Terminal, Upload, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Button, EmptyState, IconButton, Input, Progress, SearchInput, Skeleton, Spinner, cn, toast } from "@/components/ui";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { navigateTo } from "@/components/content/util";
import { SelectBox } from "@/features/content/ContentRow";
import { t, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader, formatRelative, loaderNames } from "@/lib/format";
import { qk, queryClient, useTask, waitForTask } from "@/lib/queries";
import { useSimple } from "@/lib/mode";
import type { ExtSettingKey, ExternalInstance, ExternalLauncher, LauncherKind } from "@/lib/types";
import { ImportReportView } from "./ImportReportView";
import { DEFAULT_KEYS, SETTING_KEYS, hasKey, hookLines, summary } from "./settingsFormat";

// ------------------------------------------------------------------ Laufende Importe (überleben Schließen des Dialogs)

type JobStatus = "queued" | "running" | "done" | "failed";
interface Job {
  name: string;
  status: JobStatus;
  taskId?: string;
  instanceId?: string | null;
  error?: string;
}
interface JobState {
  jobs: Record<string, Job>;
  /** IDs der zuletzt gestarteten Runde (für die Fortschrittsansicht) */
  batch: string[];
}
const useJobs = create<JobState>(() => ({ jobs: {}, batch: [] }));
const setJob = (key: string, patch: Partial<Job>) =>
  useJobs.setState((s) => ({ jobs: { ...s.jobs, [key]: { ...s.jobs[key], ...patch } as Job } }));

interface Pick {
  launcher: LauncherKind;
  inst: ExternalInstance;
  mcVersion: string | null;
}

const PARALLEL = 2;

async function runImports(picks: Pick[], keys: ExtSettingKey[]) {
  useJobs.setState((s) => ({
    batch: picks.map((p) => p.inst.source_path),
    jobs: { ...s.jobs, ...Object.fromEntries(picks.map((p) => [p.inst.source_path, { name: p.inst.name, status: "queued" as JobStatus }])) },
  }));
  const queue = [...picks];
  let ok = 0;
  let failed = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const key = p.inst.source_path;
      try {
        setJob(key, { status: "running" });
        const taskId = await api.importExternal(p.launcher, key, null, p.mcVersion, null, keys);
        setJob(key, { taskId });
        const done = await waitForTask(taskId);
        setJob(key, { status: "done", instanceId: done.instance_id });
        ok++;
        if (done.instance_id) api.instanceInstall(done.instance_id).catch((e) => toast.error(t("install.game_failed"), errorMessage(e)));
      } catch (e) {
        failed++;
        setJob(key, { status: "failed", error: errorMessage(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, picks.length) }, worker));
  queryClient.invalidateQueries({ queryKey: qk.instances });
  queryClient.invalidateQueries({ queryKey: ["launchers"] });
  const open = () => navigateTo({ to: "/instances" });
  if (failed === 0) toast.success(t(ok === 1 ? "ext.done_title_1" : "ext.done_title", { n: ok }), t("ext.done_text"), { label: t("ext.open"), onClick: open });
  else toast.error(t("ext.partial", { ok, failed }), undefined);
}

// ------------------------------------------------------------------ Hook für den Dialog

async function pickDir(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Inhalt + Fußzeile des Launcher-Imports. */
export function useExternalImport(active: boolean, onClose: () => void): { body: ReactNode; footer: ReactNode; busy: boolean; progressView: boolean } {
  const simple = useSimple();
  const tr = useT();
  const detect = useQuery({ queryKey: ["launchers"], queryFn: api.launchersDetect, enabled: active, staleTime: 0, retry: 0 });
  const [extra, setExtra] = useState<ExternalLauncher[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  /** Mitzunehmende Einstellungs-Bereiche (für alle gewählten Instanzen) */
  const [keys, setKeys] = useState<ExtSettingKey[]>(DEFAULT_KEYS);
  const { jobs, batch } = useJobs();
  const busy = batch.some((k) => jobs[k]?.status === "queued" || jobs[k]?.status === "running");
  const showProgress = batch.length > 0;

  const launchers = useMemo(() => {
    const all = [...(detect.data ?? []), ...extra];
    // Doppelte Instanzen (gleicher Pfad) nur einmal zeigen
    const seen = new Set<string>();
    return all
      .map((l) => ({ ...l, instances: l.instances.filter((i) => (seen.has(norm(i.source_path)) ? false : (seen.add(norm(i.source_path)), true))) }))
      .filter((l, i, arr) => arr.findIndex((x) => norm(x.path) === norm(l.path) && x.id === l.id) === i);
  }, [detect.data, extra]);

  const kindOf = useMemo(() => {
    const m = new Map<string, LauncherKind>();
    for (const l of launchers) for (const i of l.instances) m.set(i.source_path, l.id);
    return m;
  }, [launchers]);
  const allInstances = useMemo(() => launchers.flatMap((l) => l.instances), [launchers]);
  const q = query.trim().toLowerCase();
  const matches = (i: ExternalInstance) => !q || i.name.toLowerCase().includes(q) || i.mc_version.includes(q) || i.loader.kind.includes(q);
  const visible = allInstances.filter(matches);
  const needsVersion = (i: ExternalInstance) => !i.mc_version && !(versions[i.source_path] ?? "").trim();
  const chosen = allInstances.filter((i) => selected[i.source_path] && !needsVersion(i));
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected[i.source_path]);
  // Bereiche, die bei mindestens einer Instanz vorkommen (nur die werden zur Wahl gestellt)
  const offered = SETTING_KEYS.filter((k) => allInstances.some((i) => i.settings && hasKey(i.settings, k)));
  const toggleKey = (k: ExtSettingKey) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const someVisibleSelected = visible.some((i) => selected[i.source_path]);

  const toggle = (key: string, on?: boolean) => setSelected((s) => ({ ...s, [key]: on ?? !s[key] }));
  const toggleMany = (list: ExternalInstance[], on: boolean) => setSelected((s) => ({ ...s, ...Object.fromEntries(list.map((i) => [i.source_path, on])) }));

  const chooseDir = async () => {
    setScanError(null);
    try {
      const p = await pickDir(tr("ext.choose_dir_title"));
      if (!p) return;
      setScanning(true);
      const l = await api.launcherScanDir(p);
      setExtra((e) => [...e.filter((x) => norm(x.path) !== norm(l.path)), l]);
      // Neu gefundene, noch nicht importierte Instanzen vorauswählen
      toggleMany(l.instances.filter((i) => !i.imported_as), true);
    } catch (e) {
      setScanError(errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  const start = () => {
    const picks: Pick[] = chosen.map((i) => ({ launcher: kindOf.get(i.source_path) ?? "folder", inst: i, mcVersion: i.mc_version ? null : versions[i.source_path]?.trim() || null }));
    setSelected({});
    void runImports(picks, keys);
  };

  // ---------------------------------------------------------------- Ansichten

  let body: ReactNode;
  if (showProgress) {
    body = (
      <div className="flex flex-col gap-1.5">
        {batch.map((k) => (
          <JobRow key={k} job={jobs[k]} />
        ))}
      </div>
    );
  } else if (detect.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {tr("ext.scanning")}
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[52px]" />
        ))}
      </div>
    );
  } else if (allInstances.length === 0) {
    body = (
      <EmptyState
        icon={<FolderSearch size={30} />}
        title={tr("ext.none_title")}
        text={detect.isError ? errorMessage(detect.error) : tr("ext.none_text")}
        action={
          <Button variant="primary" icon={scanning ? <Spinner /> : <FolderOpen size={14} />} onClick={chooseDir} disabled={scanning}>
            {tr("ext.choose_dir")}
          </Button>
        }
        className="py-10"
      />
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2.5 rounded-ctl text-[13px] text-muted hover:text-text" onClick={() => toggleMany(visible, !allVisibleSelected)}>
            <SelectBox state={allVisibleSelected ? "on" : someVisibleSelected ? "mixed" : "off"} onClick={() => {}} label={tr("ext.select_all")} />
            {tr("ext.select_all")}
          </button>
          <span className="text-meta text-dim">{tr("ext.selected", { n: chosen.length, total: allInstances.length })}</span>
          <div className="flex-1" />
          {allInstances.length > 6 && <SearchInput value={query} onChange={setQuery} placeholder={tr("ext.search")} className="w-[220px]" />}
          <IconButton label={tr("ext.choose_dir")} tip variant="ghost" disabled={scanning} onClick={chooseDir}>
            {scanning ? <Spinner /> : <FolderOpen size={16} />}
          </IconButton>
        </div>
        {offered.length > 0 && <SettingsBar offered={offered} keys={keys} onToggle={toggleKey} />}
        <div className="scroll -mx-1 flex max-h-[calc(100vh-430px)] min-h-[180px] flex-col gap-4 overflow-y-auto px-1">
          {launchers.map((l) => {
            const list = l.instances.filter(matches);
            if (q && list.length === 0) return null;
            const groupOn = list.length > 0 && list.every((i) => selected[i.source_path]);
            const groupSome = list.some((i) => selected[i.source_path]);
            return (
              <section key={`${l.id}|${l.path}`} className="flex flex-col">
                <div className="flex items-center gap-2.5 px-2 pb-1.5">
                  <SelectBox state={groupOn ? "on" : groupSome ? "mixed" : "off"} onClick={() => toggleMany(list, !groupOn)} label={l.name} />
                  <span className="text-section text-text">{l.name}</span>
                  <span className="text-meta tabular-nums text-dim">{l.instances.length}</span>
                  {/* Ordnerpfad nur im Experten-Modus (Simple: Tooltip reicht) */}
                  <span className="selectable min-w-0 flex-1 truncate text-right text-caption text-dim" title={l.path}>
                    {simple ? "" : l.path}
                  </span>
                  {extra.some((x) => x.path === l.path) && (
                    <IconButton
                      label={tr("ext.remove_dir")}
                      tip
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6"
                      onClick={() => setExtra((e) => e.filter((x) => x.path !== l.path))}
                    >
                      <X size={14} />
                    </IconButton>
                  )}
                </div>
                {l.id === "norisk" && (
                  <div className="flex items-start gap-1.5 px-2 pb-1.5 text-[12px] text-dim">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {tr("ext.norisk_hint")}
                  </div>
                )}
                {list.length === 0 ? (
                  <div className="px-2 py-3 text-meta text-dim">{tr("ext.empty_group")}</div>
                ) : (
                  list.map((i) => (
                    <InstanceRow
                      key={i.source_path}
                      inst={i}
                      selected={!!selected[i.source_path]}
                      onToggle={() => toggle(i.source_path)}
                      version={versions[i.source_path] ?? ""}
                      onVersion={(v) => setVersions((s) => ({ ...s, [i.source_path]: v }))}
                      keys={keys}
                    />
                  ))
                )}
              </section>
            );
          })}
          {q && visible.length === 0 && <div className="py-8 text-center text-[13px] text-dim">{tr("ext.no_match")}</div>}
        </div>
      </div>
    );
  }

  const footer: ReactNode = showProgress ? (
    <>
      {busy ? (
        <Button variant="ghost" onClick={onClose}>
          {tr("install.background")}
        </Button>
      ) : (
        <>
          <Button variant="subtle" onClick={() => useJobs.setState({ batch: [] })}>
            {tr("ext.more")}
          </Button>
          <Button
            variant="primary"
            icon={<Check size={14} />}
            onClick={() => {
              useJobs.setState({ batch: [] });
              onClose();
            }}
          >
            {tr("ext.finish")}
          </Button>
        </>
      )}
    </>
  ) : (
    <>
      {scanError && (
        <span className="mr-auto flex min-w-0 items-center gap-1.5 text-meta text-danger" title={scanError}>
          <AlertTriangle size={14} className="shrink-0" />
          <span className="truncate">{tr("ext.scan_failed")}: {scanError}</span>
        </span>
      )}
      <Button variant="subtle" onClick={onClose}>
        {tr("common.cancel")}
      </Button>
      <Button variant="primary" icon={<Upload size={14} />} disabled={chosen.length === 0} onClick={start}>
        {chosen.length === 0 ? tr("import.start") : chosen.length === 1 ? tr("ext.import_1") : tr("ext.import_n", { n: chosen.length })}
      </Button>
    </>
  );

  return { body, footer, busy, progressView: showProgress };
}

// ------------------------------------------------------------------ Einstellungen mitnehmen

/** Bereiche zum An-/Abwählen (gelten für alle gewählten Instanzen). Start-Befehle sind aus, bis man sie wählt. */
function SettingsBar({ offered, keys, onToggle }: { offered: ExtSettingKey[]; keys: ExtSettingKey[]; onToggle: (k: ExtSettingKey) => void }) {
  const tr = useT();
  const hooksOn = keys.includes("hooks") && offered.includes("hooks");
  return (
    <div className="flex flex-col gap-2 rounded-card bg-white/[.03] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12.5px] font-semibold text-text" title={tr("ext.set.hint")}>
          {tr("ext.set.title")}
        </span>
        {offered.map((k) => {
          const on = keys.includes(k);
          return (
            <button
              key={k}
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(k)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-[12.5px] font-medium transition-colors duration-100",
                on ? "bg-brand/15 text-text hover:bg-brand/20" : "bg-white/[.04] text-dim hover:bg-white/[.07] hover:text-muted",
                k === "hooks" && on && "bg-warn/15 hover:bg-warn/20",
              )}
            >
              {on ? <Check size={12} strokeWidth={3} className={k === "hooks" ? "text-warn" : "text-brand"} /> : k === "hooks" ? <Terminal size={12} /> : <span className="h-3 w-3 rounded-xs border border-white/25" />}
              {tr(`ext.set.key.${k}`)}
            </button>
          );
        })}
      </div>
      <p className={cn("text-[12px] leading-snug", hooksOn ? "text-warn" : "text-dim")}>{hooksOn ? tr("ext.set.hooks_warn") : tr("ext.set.hint")}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Zeilen

function InstanceRow({
  inst,
  selected,
  onToggle,
  version,
  onVersion,
  keys,
}: {
  inst: ExternalInstance;
  selected: boolean;
  onToggle: () => void;
  version: string;
  onVersion: (v: string) => void;
  keys: ExtSettingKey[];
}) {
  const tr = useT();
  const takes = summary(inst.settings, keys);
  const hooks = keys.includes("hooks") && inst.settings ? hookLines(inst.settings) : [];
  const loader = formatLoader(inst.loader);
  const sub = [
    inst.mc_version ? `${loaderNames[inst.loader.kind]} ${inst.mc_version}` : loader,
    tr("ext.mods", { n: inst.mod_count }),
    inst.last_played ? tr("ext.played", { when: formatRelative(inst.last_played) }) : tr("ext.never_played"),
  ];
  return (
    <div
      role="row"
      onClick={onToggle}
      className={cn(
        "group flex cursor-default items-center gap-3 rounded-ctl px-2 py-2 transition-colors duration-100 hover:bg-white/[.03]",
        selected && "bg-white/[.05] hover:bg-white/[.06]",
      )}
    >
      <SelectBox
        state={selected ? "on" : "off"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        label={inst.name}
      />
      <ProjectIcon src={inst.icon} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-text">{inst.name}</span>
          {inst.imported_as && <span className="shrink-0 rounded-xs bg-white/[.06] px-1.5 py-px text-caption text-muted">{tr("ext.imported")}</span>}
        </div>
        <div className="truncate text-meta text-dim">{sub.join(" · ")}</div>
        {takes.length > 0 && (
          <div className="mt-0.5 truncate text-[12px] text-muted" title={takes.join(" · ")}>
            {tr("ext.set.takes", { list: takes.join(" · ") })}
          </div>
        )}
        {hooks.map((h) => (
          <div key={h.label} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-warn">
            <Terminal size={12} className="shrink-0" />
            <span className="shrink-0">{h.label}:</span>
            <code className="selectable min-w-0 truncate font-mono text-[11.5px]" title={h.cmd}>
              {h.cmd}
            </code>
          </div>
        ))}
        {inst.warning && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-warn">
            <AlertTriangle size={12} className="shrink-0" />
            <span className="truncate">{inst.warning}</span>
          </div>
        )}
      </div>
      {!inst.mc_version && (
        <div className="w-[120px] shrink-0" onClick={(e) => e.stopPropagation()}>
          <Input value={version} onChange={(e) => onVersion(e.target.value)} placeholder={tr("ext.version_placeholder")} aria-label={tr("ext.version_needed")} invalid={selected && !version.trim()} />
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: Job | undefined }) {
  const tr = useT();
  const task = useTask(job?.taskId);
  if (!job) return null;
  const status = job.status;
  return (
    <div className="flex flex-col gap-1.5 border-line px-1 py-2.5 [&+&]:border-t">
      <div className="flex items-center gap-2.5">
        {status === "done" ? (
          <Check size={15} className="shrink-0 text-ok" />
        ) : status === "failed" ? (
          <AlertTriangle size={15} className="shrink-0 text-danger" />
        ) : status === "running" ? (
          <Spinner />
        ) : (
          <span className="h-[14px] w-[14px] shrink-0 rounded-dot bg-surface3" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">{job.name}</span>
        <span className="shrink-0 text-[12px] text-dim">
          {tr(`ext.status.${status}`)}
          {status === "running" && task?.progress != null ? ` · ${Math.round(task.progress * 100)} %` : ""}
        </span>
      </div>
      {status === "running" && <Progress value={task?.progress ?? null} />}
      {status === "running" && task?.message && <div className="truncate text-[12px] text-dim">{task.message}</div>}
      {status === "done" && job.instanceId && <ImportReportView instanceId={job.instanceId} fallback={task?.message ?? null} />}
      {status === "failed" && <div className="selectable break-words text-[12px] text-danger">{job.error}</div>}
    </div>
  );
}
