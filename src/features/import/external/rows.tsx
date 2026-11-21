import { AlertTriangle, Check, Terminal } from "lucide-react";
import { Input, Progress, Spinner, cn } from "@/components/ui";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { SelectBox } from "@/features/content/ContentRow";
import { useT } from "@/i18n";
import { formatLoader, formatRelative, loaderNames } from "@/lib/format";
import { useTask } from "@/lib/queries";
import type { ExtSettingKey, ExternalInstance } from "@/lib/types";
import { ImportReportView } from "../ImportReportView";
import { hookLines, summary } from "../settingsFormat";
import type { Job } from "./jobs";

// ------------------------------------------------------------------ Einstellungen mitnehmen

/** Bereiche zum An-/Abwählen (gelten für alle gewählten Instanzen). Start-Befehle sind aus, bis man sie wählt. */
export function SettingsBar({ offered, keys, onToggle }: { offered: ExtSettingKey[]; keys: ExtSettingKey[]; onToggle: (k: ExtSettingKey) => void }) {
  const tr = useT();
  const hooksOn = keys.includes("hooks") && offered.includes("hooks");
  return (
    <div className="flex flex-col gap-2 rounded-card bg-white/[.03] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
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

export function InstanceRow({
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
        "group flex cursor-pointer flex-wrap items-center gap-3 rounded-ctl border border-transparent px-2 py-3 transition-colors duration-100 hover:bg-surface2",
        selected && "border-accent/35 bg-accent/[.08] hover:bg-accent/[.12]",
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
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="min-w-0 break-words text-[16px] font-semibold text-text">{inst.name}</span>
          {inst.imported_as && <span className="shrink-0 rounded-xs bg-white/[.06] px-1.5 py-px text-caption text-muted">{tr("ext.imported")}</span>}
        </div>
        <div className="break-words text-[14px] text-muted">{sub.join(" · ")}</div>
        {takes.length > 0 && (
          <div className="mt-1 break-words text-[13px] text-muted" title={takes.join(" · ")}>
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
        <div className="w-[144px] shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="text-[13px] text-muted">{tr("ext.version_needed")}</div>
          <Input value={version} onChange={(e) => onVersion(e.target.value)} placeholder={tr("ext.version_placeholder")} aria-label={tr("ext.version_needed")} invalid={selected && !version.trim()} />
        </div>
      )}
    </div>
  );
}

export function JobRow({ job }: { job: Job | undefined }) {
  const tr = useT();
  const task = useTask(job?.taskId);
  if (!job) return null;
  const status = job.status;
  return (
    <div className="flex flex-col gap-1.5 border-line px-1 py-3 [&+&]:border-t">
      <div className="flex items-center gap-2.5">
        {status === "done" ? (
          <Check size={17} className="shrink-0 text-ok" />
        ) : status === "failed" ? (
          <AlertTriangle size={17} className="shrink-0 text-danger" />
        ) : status === "running" ? (
          <Spinner />
        ) : (
          <span className="h-[14px] w-[14px] shrink-0 rounded-dot bg-surface3" />
        )}
        <span className="min-w-0 flex-1 break-words text-[15px] font-semibold text-text">{job.name}</span>
        <span className="shrink-0 text-[13px] text-muted">
          {tr(`ext.status.${status}`)}
          {status === "running" && task?.progress != null ? ` · ${Math.round(task.progress * 100)} %` : ""}
        </span>
      </div>
      {status === "running" && <Progress value={task?.progress ?? null} />}
      {status === "running" && task?.message && <div className="truncate text-[13px] text-muted">{task.message}</div>}
      {status === "done" && job.instanceId && <ImportReportView instanceId={job.instanceId} fallback={task?.message ?? null} />}
      {status === "failed" && <div className="selectable break-words text-[14px] text-danger">{job.error}</div>}
    </div>
  );
}
