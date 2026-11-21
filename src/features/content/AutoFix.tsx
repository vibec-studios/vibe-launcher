// „Probleme beheben“ in einem Klick: Plan laden (Abhängigkeiten, Konflikte, letzte Crash-Analyse), Vorschau
// („Das wird gemacht“) mit abwählbaren Schritten, ausführen (vorher Snapshot) und Zusammenfassung mit „Rückgängig“.
// Nach einem Absturz stehen die erkannten Ursachen oben (Erklärung, Fundstelle, zugehörige Schritte); der Bericht
// zeigt je Ursache „behoben“ / „nicht automatisch lösbar“ und bietet „Testen“ (erneute Prüfung ohne den alten Absturz).
// Außerdem die Rückfrage vor dem Start („Trotzdem starten“ / „Beheben und starten“).
import { useQuery } from "@tanstack/react-query";
import { ReportProblemButton } from "@/features/feedback/FeedbackButtons";
import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  Cpu,
  Download,
  ExternalLink,
  FileWarning,
  Info,
  MemoryStick,
  PackageCheck,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Undo2,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Dialog, Progress, Skeleton, cn, confirm, toast } from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, useInstances, useSettings, useTaskStore, waitForTask } from "@/lib/queries";
import { patchSettings } from "@/lib/mode";
import { DEFAULT_FIX_BACKUP, FixBackupPicker, useScopeList } from "@/features/backups/FixBackupPicker";
import { loaderNames } from "@/lib/format";
import type { Diagnosis, FixAction, FixBackup, FixPlan, FixReport, FixStep, Instance, LoaderKind, QuickCheck, Unfixable } from "@/lib/types";
import { Evidence, diagText } from "@/features/logs/Diagnosis";
import { uploadCrash } from "@/features/logs/LogsTab";
import { openAutofix, skipLaunchCheck, useAutofix, type FixRequest, type PreChoice } from "./autofixStore";

// ------------------------------------------------------------------ Texte

function actionText(a: FixAction, t: ReturnType<typeof useT>, step?: FixStep): string {
  const main = !!step && JSON.stringify(step.action) === JSON.stringify(a);
  switch (a.kind) {
    case "install":
      return t("fix.do.install", { title: a.title });
    case "replace":
      return a.manual ? t("fix.do.replace_manual", { title: a.title, to: a.to_version }) : t("fix.do.replace", { title: a.title, to: a.to_version });
    case "enable":
      return t("fix.do.enable", { name: main ? step!.name : fileLabel(a.file_name) });
    case "disable":
      return t("fix.do.disable", { name: step ? (main ? step.name : (step.alt_name ?? fileLabel(a.file_name))) : fileLabel(a.file_name) });
    case "set_java":
      return t("fix.do.java", { major: a.major });
    case "set_ram":
      return t("fix.do.ram", { gb: Math.round(a.mb / 1024) });
    case "set_loader":
      // Nach oben = „aktualisieren“; nach unten bzw. unbekannte Version = neutral „umstellen“
      return t(step?.reason === "loader_too_old" ? "fix.do.loader_up" : "fix.do.loader_set", { loader: loaderNames[a.loader], to: a.to });
    case "repair_loader":
      return a.version ? t("fix.do.loader_repair", { loader: loaderNames[a.loader], version: a.version }) : t("fix.do.loader_repair_any", { loader: loaderNames[a.loader] });
    case "reset_config":
      return t("fix.do.reset_config", { path: a.path });
  }
}

/** Anzeigename eines Loaders aus der Mod-Metadaten-Kennung („forge“, „fabric“ …). */
function loaderLabel(l: string | null): string {
  return (l && loaderNames[l as LoaderKind]) || l || "?";
}

function fileLabel(f: string) {
  return f.replace(/\.disabled$/, "").replace(/\.jar$/, "");
}

function actionIcon(a: FixAction, size = 15): ReactNode {
  switch (a.kind) {
    case "install":
      return <Download size={size} />;
    case "replace":
      return a.manual ? <ExternalLink size={size} /> : <RefreshCw size={size} />;
    case "enable":
      return <Power size={size} />;
    case "disable":
      return <PowerOff size={size} />;
    case "set_java":
      return <Cpu size={size} />;
    case "set_ram":
      return <MemoryStick size={size} />;
    case "set_loader":
      return <ArrowUpCircle size={size} />;
    case "repair_loader":
      return <PackageCheck size={size} />;
    case "reset_config":
      return <RotateCcw size={size} />;
  }
}

function stepSub(s: FixStep, t: ReturnType<typeof useT>, instLoader?: LoaderKind, inCause = false): string {
  const inst = instLoader ? loaderNames[instLoader] : "";
  const a = s.action;
  let parts: string[];
  if (s.reason === "wrong_loader" && s.detail) {
    // „Für Forge gebaut – die Instanz nutzt Fabric“ bzw. beim Ersatz „Passende Version für Fabric“
    parts = [a.kind === "install" ? t("fix.reason.wrong_loader_variant", { loader: inst }) : t("fix.reason.wrong_loader_of", { mod: loaderLabel(s.detail), loader: inst })];
  } else {
    parts = [t(`fix.reason.${s.reason}`)];
  }
  if (a.kind === "replace" && a.from_version && !a.manual) parts.push(`${a.from_version} → ${a.to_version}`);
  if (a.kind === "set_java") parts.push(a.path ? t("fix.java.found") : t("fix.java.download"));
  if (a.kind === "set_loader" && a.from) parts.push(`${a.from} → ${a.to}`);
  if (a.kind === "set_loader" && s.detail) parts.push(t("fix.loader.requires", { detail: s.detail }));
  else if (s.required_by.length) parts.push(t("fix.needed_by", { names: s.required_by.slice(0, 3).join(", ") + (s.required_by.length > 3 ? " …" : "") }));
  if ((s.reason === "loader_files_missing" || s.reason === "loader_files_broken") && s.detail)
    parts.push(t(s.detail === "1" ? "fix.loader.files_1" : "fix.loader.files", { n: s.detail }));
  if (a.kind === "repair_loader") parts.push(t("fix.loader.repair_hint"));
  if (a.kind === "reset_config") parts.push(t("fix.config.hint"));
  if (s.reason === "known_pair" && s.detail) parts.push(t("fix.pair.source", { source: s.detail }));
  if (s.from_crash && !inCause) parts.push(t("fix.from_crash"));
  return parts.join(" · ");
}

// ------------------------------------------------------------------ Dialog

type Phase = "preview" | "running" | "done" | "undoing" | "undone";

function StepRow({
  s,
  on,
  alt,
  onToggle,
  onAlt,
  instLoader,
  inCause,
}: {
  s: FixStep;
  on: boolean;
  alt: boolean;
  onToggle: (v: boolean) => void;
  onAlt: (v: boolean) => void;
  instLoader?: LoaderKind;
  inCause?: boolean;
}) {
  const t = useT();
  const a = alt && s.alt ? s.alt : s.action;
  return (
    <div className={cn("flex items-start gap-3 rounded-ctl px-3 py-2.5 transition-colors duration-100", on ? "bg-surface2" : "bg-surface")}>
      <Checkbox checked={on} onChange={onToggle} label={actionText(a, t, s)} className="mt-[3px]" />
      <span className={cn("mt-[3px] shrink-0", on ? "text-accent" : "text-dim")}>{actionIcon(a)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-[13.5px] font-semibold", on ? "text-text" : "text-muted")}>{actionText(a, t, s)}</span>
          {s.confirm && <span className="shrink-0 rounded-xs bg-warn/15 px-1.5 py-px text-[11px] font-semibold text-warn">{t("fix.confirm_tag")}</span>}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-dim">{stepSub(s, t, instLoader, inCause)}</div>
        {s.alt && (
          <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label={t("fix.alt_label")}>
            {[false, true].map((v) => (
              <button
                key={String(v)}
                role="radio"
                aria-checked={alt === v}
                onClick={() => {
                  onAlt(v);
                  onToggle(true);
                }}
                className={cn(
                  "h-7 rounded-ctl px-2.5 text-[12px] font-medium transition-colors duration-100",
                  alt === v ? "bg-white/[.1] text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
                )}
              >
                {t("fix.do.disable", { name: v ? (s.alt_name ?? "") : s.name })}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Nächster Schritt, wenn eine Ursache nicht automatisch lösbar ist. */
function NextStep({ d, instanceId, crashReport, showHint = true }: { d: Diagnosis; instanceId: string; crashReport?: string | null; showHint?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const key = d.id === "graphics" || d.id === "heap_reserve" ? `fix.next.${d.id}` : "fix.next.default";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
      {showHint && <span className="min-w-0 flex-1">{t(key)}</span>}
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        icon={<UploadCloud size={13} />}
        onClick={async () => {
          setBusy(true);
          await uploadCrash(instanceId, crashReport ?? null);
          setBusy(false);
        }}
      >
        {t("fix.share_log")}
      </Button>
      <ReportProblemButton instanceId={instanceId} source="autofix" />
    </div>
  );
}

function unfixableText(u: Unfixable, t: ReturnType<typeof useT>) {
  return t(`fix.unfixable.${u.reason}`, { name: u.name, detail: u.detail ?? "" });
}

/** Eine Absturzursache: Erklärung, Fundstelle und die Schritte, die sie beheben. */
function CauseCard({
  d,
  steps,
  unfixable,
  row,
  instanceId,
  crashReport,
}: {
  d: Diagnosis;
  steps: FixStep[];
  unfixable: Unfixable[];
  row: (s: FixStep, inCause?: boolean) => ReactNode;
  instanceId: string;
  crashReport?: string | null;
}) {
  const t = useT();
  const { title, text } = diagText(d, t);
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-surface p-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_22%,transparent)]">
      <div className="flex items-start gap-2.5">
        <FileWarning size={15} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-text">{title}</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{text}</p>
          <Evidence d={d} />
        </div>
      </div>
      {steps.length > 0 && <div className="flex flex-col gap-1.5">{steps.map((s) => row(s, true))}</div>}
      {unfixable.map((u, i) => (
        <div key={i} className="flex items-start gap-2 px-1 text-[12.5px] text-muted">
          <AlertTriangle size={13} className="mt-px shrink-0 text-warn" />
          <span className="selectable min-w-0">{unfixableText(u, t)}</span>
        </div>
      ))}
      {steps.length === 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <span className="text-[12px] font-semibold text-warn">{t("fix.cause.manual")}</span>
          <NextStep d={d} instanceId={instanceId} crashReport={crashReport} showHint={!unfixable.length || d.id === "graphics"} />
        </div>
      )}
    </div>
  );
}

function PlanView({
  plan,
  sel,
  alt,
  setSel,
  setAlt,
  instLoader,
  backup,
  setBackup,
  instanceId,
  crashReport,
}: {
  plan: FixPlan;
  instanceId: string;
  crashReport?: string | null;
  instLoader?: LoaderKind;
  backup: FixBackup;
  setBackup: (b: FixBackup) => void;
  sel: Record<string, boolean>;
  alt: Record<string, boolean>;
  setSel: (id: string, v: boolean) => void;
  setAlt: (id: string, v: boolean) => void;
}) {
  const t = useT();
  const causes = plan.causes ?? [];
  // Schritte einer Absturzursache stehen in deren Karte oben
  const inCause = (x: { cause?: number | null }) => x.cause != null && x.cause < causes.length;
  const rest = plan.steps.filter((s) => !inCause(s));
  // Loader-Schritte als eigener Abschnitt: betreffen die ganze Instanz, nicht einzelne Mods
  const isLoader = (s: FixStep) => s.action.kind === "set_loader" || s.action.kind === "repair_loader";
  const loader = rest.filter(isLoader);
  const normal = rest.filter((s) => !s.confirm && !isLoader(s));
  const ask = rest.filter((s) => s.confirm && !isLoader(s));
  const unfixable = plan.unfixable.filter((u) => !inCause(u));
  const manual = plan.steps.some((s) => s.action.kind === "replace" && s.action.manual);
  const loaderChange = plan.steps.some((s) => s.action.kind === "set_loader");
  const row = (s: FixStep, cause = false) => (
    <StepRow key={s.id} s={s} on={!!sel[s.id]} alt={!!alt[s.id]} onToggle={(v) => setSel(s.id, v)} onAlt={(v) => setAlt(s.id, v)} instLoader={instLoader} inCause={cause} />
  );
  return (
    <div className="flex flex-col gap-4">
      {causes.length > 0 && (
        <section className="flex flex-col gap-2">
          <div>
            <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.causes.title")}</h3>
            <p className="text-[12px] text-dim">{t("fix.causes.text")}</p>
          </div>
          {causes.map((d, i) => (
            <CauseCard
              key={i}
              d={d}
              steps={plan.steps.filter((s) => s.cause === i)}
              unfixable={plan.unfixable.filter((u) => u.cause === i)}
              row={row}
              instanceId={instanceId}
              crashReport={crashReport}
            />
          ))}
        </section>
      )}
      {loader.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.loader.title")}</h3>
          {loader.map((s) => row(s))}
        </section>
      )}
      {normal.length > 0 && (
        <section className="flex flex-col gap-1.5">
          {loader.length > 0 && <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.mods.title")}</h3>}
          {normal.map((s) => row(s))}
        </section>
      )}
      {ask.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.ask_title")}</h3>
          <p className="-mt-1 mb-0.5 text-[12px] text-dim">{t("fix.ask_text")}</p>
          {ask.map((s) => row(s))}
        </section>
      )}
      {unfixable.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.unfixable.title")}</h3>
          {unfixable.map((u, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-1.5 text-[12.5px] text-muted">
              <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />
              <span className="selectable min-w-0">{unfixableText(u, t)}</span>
            </div>
          ))}
        </section>
      )}
      {plan.steps.length > 0 && (
        <section className="flex flex-col gap-1.5 border-t border-line pt-3">
          <h3 className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
            <ShieldCheck size={13} className={backup.mode === "none" ? "text-dim" : "text-ok"} />
            {t("fix.backup.title")}
          </h3>
          <FixBackupPicker value={backup} onChange={setBackup} />
          <p className="text-[11.5px] text-dim">{t("fix.backup.remembered")}</p>
        </section>
      )}
      <div className="flex flex-col gap-1 text-[12px] text-dim empty:hidden">
        {manual && (
          <span className="flex items-center gap-2">
            <ExternalLink size={13} className="shrink-0" />
            {t("fix.manual_note")}
          </span>
        )}
        {loaderChange && (
          <span className="flex items-center gap-2">
            <Undo2 size={13} className="shrink-0" />
            {t("fix.loader_note")}
          </span>
        )}
      </div>
    </div>
  );
}

/** Lässt sich etwas zurückstellen? Ohne Sicherung nur Java/RAM, Loader, Configs und vorgemerkte Downloads (wie `can_undo`). */
function canUndo(r: FixReport) {
  return !!r.snapshot_id || !!r.prev_java || !!r.prev_loader || r.manual.length > 0 || (r.config_backups?.length ?? 0) > 0;
}

type CauseStatus = "fixed" | "partial" | "failed" | "skipped" | "manual";

/** Ergebnis je Absturzursache aus den ausgeführten Schritten. */
export function causeStatus(i: number, plan: FixPlan, report: FixReport): CauseStatus {
  const steps = plan.steps.filter((s) => s.cause === i);
  if (!steps.length) return "manual";
  const same = (a: FixAction | null, b: FixAction) => !!a && JSON.stringify(a) === JSON.stringify(b);
  const ran = report.results.filter((r) => steps.some((s) => same(s.action, r.action) || same(s.alt, r.action)));
  if (!ran.length) return "skipped";
  const ok = ran.filter((r) => r.ok).length;
  return ok === ran.length ? "fixed" : ok > 0 ? "partial" : "failed";
}

const statusStyle: Record<CauseStatus, string> = {
  fixed: "bg-ok/15 text-ok",
  partial: "bg-warn/15 text-warn",
  failed: "bg-danger/15 text-danger",
  skipped: "bg-white/[.06] text-muted",
  manual: "bg-warn/15 text-warn",
};

export type Verify = "running" | { open: number };

function VerifyView({ v, onAgain }: { v: Verify; onAgain: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5 rounded-ctl bg-surface px-3.5 py-3">
      {v === "running" ? (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <RefreshCw size={13} className="animate-spin" />
          {t("fix.verify.running")}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 text-[13px] font-semibold", v.open ? "text-warn" : "text-ok")}>
            {v.open ? <AlertTriangle size={14} className="shrink-0" /> : <Check size={14} strokeWidth={2.5} className="shrink-0" />}
            {v.open ? t(v.open === 1 ? "fix.verify.open_1" : "fix.verify.open", { n: v.open }) : t("fix.verify.ok")}
          </span>
          {v.open > 0 && (
            <Button size="sm" icon={<Wrench size={13} />} onClick={onAgain}>
              {t("fix.verify.again")}
            </Button>
          )}
        </div>
      )}
      <span className="flex items-center gap-2 text-[12px] text-dim">
        <Play size={12} className="shrink-0" />
        {t("fix.verify.hint")}
      </span>
    </div>
  );
}

function ReportView({
  report,
  undone,
  plan,
  instanceId,
  crashReport,
  verify,
  onAgain,
}: {
  report: FixReport;
  undone: boolean;
  plan: FixPlan | undefined;
  instanceId: string;
  crashReport?: string | null;
  verify: Verify | null;
  onAgain: () => void;
}) {
  const t = useT();
  const steps = plan?.steps ?? [];
  const causes = plan?.causes ?? [];
  const scopeList = useScopeList();
  const scoped = !!report.snapshot_id && !!report.snapshot_scopes;
  const doneText = report.snapshot_id
    ? scoped
      ? t("fix.done.text_scoped", { areas: scopeList(report.snapshot_scopes) })
      : t("fix.done.text")
    : canUndo(report)
      ? t("fix.done.no_backup")
      : t("fix.done.no_undo");
  const undoneText = report.snapshot_id ? (scoped ? t("fix.undone.text_scoped", { areas: scopeList(report.snapshot_scopes) }) : t("fix.undone.text")) : t("fix.undone.text_settings");
  // Namen aus dem Plan (Dateinamen sind im Ergebnis nicht schön)
  const same = (a: FixAction | null, b: FixAction) => !!a && JSON.stringify(a) === JSON.stringify(b);
  const stepOf = (a: FixAction) => steps.find((s) => same(s.action, a) || same(s.alt, a));
  const ok = report.results.filter((r) => r.ok).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-ctl bg-surface px-3.5 py-3">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-ctl", undone ? "bg-white/[.06] text-muted" : ok === report.results.length ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn")}>
          {undone ? <Undo2 size={18} /> : ok === report.results.length ? <Check size={18} strokeWidth={2.5} /> : <AlertTriangle size={17} />}
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-text">{undone ? t("fix.undone.title") : t("fix.done.count", { ok, n: report.results.length })}</div>
          <div className="text-[12.5px] text-muted">{undone ? undoneText : doneText}</div>
        </div>
      </div>
      {!undone && causes.length > 0 && plan && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.done.causes")}</h3>
          {causes.map((d, i) => {
            const st = causeStatus(i, plan, report);
            return (
              <div key={i} className="flex flex-col gap-1.5 rounded-ctl bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{diagText(d, t).title}</span>
                  <span className={cn("shrink-0 rounded-xs px-1.5 py-px text-[11px] font-semibold", statusStyle[st])}>{t(`fix.status.${st}`)}</span>
                </div>
                {(st === "manual" || st === "failed") && <NextStep d={d} instanceId={instanceId} crashReport={crashReport} />}
              </div>
            );
          })}
        </section>
      )}
      <div className="flex flex-col">
        {report.results.map((r, i) => (
          <div key={i} className="flex items-start gap-2.5 px-1 py-1.5 text-[13px]">
            <span className={cn("mt-px shrink-0", undone ? "text-dim" : r.ok ? "text-ok" : "text-danger")}>{r.ok ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}</span>
            <span className="min-w-0 flex-1">
              <span className={cn(undone ? "text-muted line-through decoration-white/20" : "text-text")}>{actionText(r.action, t, stepOf(r.action))}</span>
              {r.error && <span className="selectable block text-[12px] text-danger">{r.error}</span>}
            </span>
          </div>
        ))}
      </div>
      {!undone && report.manual.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.done.manual")}</h3>
          <p className="-mt-1 text-[12px] text-dim">{t("fix.done.manual_text")}</p>
          {report.manual.map((m) => (
            <button
              key={m.file_name}
              onClick={() => void openExternal(m.page_url)}
              className="flex h-10 items-center gap-3 rounded-ctl bg-surface px-3 text-left text-[13px] transition-colors hover:bg-surface2"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-text" title={m.file_name}>
                {m.project_name}
                {m.version_number && <span className="ml-2 text-dim">{m.version_number}</span>}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-brand">
                {t("manual.download_short")}
                <ExternalLink size={12} />
              </span>
            </button>
          ))}
        </section>
      )}
      {!undone && verify && <VerifyView v={verify} onAgain={onAgain} />}
    </div>
  );
}

function AutofixDialog({ req, onClose }: { req: FixRequest; onClose: () => void }) {
  const t = useT();
  const { launch } = useInstanceActions();
  const { data: instances } = useInstances();
  const inst = instances?.find((i) => i.id === req.instanceId) ?? null;
  // Nach „Erneut beheben“ zählt der alte Absturz nicht mehr – nur noch statisch prüfen
  const [ignoreCrash, setIgnoreCrash] = useState(false);
  const [verify, setVerify] = useState<Verify | null>(null);
  const plan = useQuery({
    queryKey: ["autofix-plan", req.instanceId, req.crashReport ?? null, req.exitCode ?? null, ignoreCrash],
    queryFn: () => api.autofixPlan(req.instanceId, ignoreCrash ? null : req.crashReport, ignoreCrash ? null : req.exitCode, ignoreCrash),
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  });
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [alt, setAlt] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("preview");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [report, setReport] = useState<FixReport | null>(null);
  const task = useTaskStore((s) => (taskId ? s.tasks[taskId] : undefined));
  // Sicherung vorher: aus den Einstellungen, Änderungen werden dort gemerkt
  const settings = useSettings();
  const [backupChoice, setBackupChoice] = useState<FixBackup | null>(null);
  const backup = backupChoice ?? settings.data?.fix_backup ?? DEFAULT_FIX_BACKUP;
  const changeBackup = (b: FixBackup) => {
    setBackupChoice(b);
    void patchSettings({ fix_backup: b }).catch((e) => toast.error(e));
  };

  useEffect(() => {
    if (plan.data) setSel(Object.fromEntries(plan.data.steps.map((s) => [s.id, s.selected])));
  }, [plan.data]);

  const chosen = useMemo(() => (plan.data?.steps ?? []).filter((s) => sel[s.id]), [plan.data, sel]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["content", req.instanceId] });
    void queryClient.invalidateQueries({ queryKey: qk.instances });
    void queryClient.invalidateQueries({ queryKey: ["diagnose", req.instanceId] });
    void queryClient.invalidateQueries({ queryKey: ["missing", req.instanceId] });
  };

  const run = async () => {
    const conflicts = chosen.filter((s) => s.confirm);
    if (conflicts.length) {
      const ok = await confirm({
        title: t("fix.confirm.title"),
        text: t("fix.confirm.text", { n: conflicts.length, names: conflicts.map((s) => (alt[s.id] ? s.alt_name : s.name)).join(", ") }),
        confirmLabel: t("fix.confirm.ok"),
      });
      if (!ok) return;
    }
    const actions = chosen.map((s) => (alt[s.id] && s.alt ? s.alt : s.action));
    setPhase("running");
    try {
      const id = await api.autofixApply(req.instanceId, actions, backup);
      setTaskId(id);
      await waitForTask(id).catch((e) => {
        if (!isCancelled(e)) toast.error(e, t("fix.failed"));
      });
      const r = await api.autofixLast(req.instanceId);
      refresh();
      if (r && r.results.length) {
        setReport(r);
        setPhase("done");
      } else {
        setPhase("preview");
        void plan.refetch();
      }
    } catch (e) {
      toast.error(e, t("fix.failed"));
      setPhase("preview");
    }
  };

  const undo = async () => {
    setPhase("undoing");
    try {
      const id = await api.autofixUndo(req.instanceId);
      setTaskId(id);
      await waitForTask(id);
      setPhase("undone");
      setReport((r) => (r ? { ...r, undone: true } : r));
    } catch (e) {
      toast.error(errorMessage(e), t("fix.undo_failed"));
      setPhase("done");
    } finally {
      refresh();
    }
  };

  /** „Testen“: erneute statische Prüfung (ohne den alten Absturz). */
  const runVerify = async () => {
    setVerify("running");
    try {
      const p = await api.autofixPlan(req.instanceId, null, null, true);
      setVerify({ open: p.steps.length + p.unfixable.length });
    } catch (e) {
      toast.error(e, t("fix.failed"));
      setVerify(null);
    }
  };
  const fixAgain = () => {
    setVerify(null);
    setReport(null);
    setTaskId(null);
    setIgnoreCrash(true);
    setPhase("preview");
    void plan.refetch();
  };

  const startNow = () => {
    onClose();
    if (inst) void launch(inst, null, null, { skipCheck: true });
  };

  const busy = phase === "running" || phase === "undoing";
  const steps = plan.data?.steps ?? [];
  const title = phase === "done" ? t("fix.done.title") : phase === "undone" ? t("fix.undone.title") : t("fix.title");
  const causes = plan.data?.causes ?? [];
  const description =
    phase === "preview"
      ? plan.data && (steps.length || plan.data.unfixable.length || causes.length)
        ? t(plan.data.crash && causes.length ? "fix.desc_crash" : "fix.desc", { name: inst?.name ?? "" })
        : undefined
      : undefined;

  let footer: ReactNode = null;
  if (phase === "preview") {
    footer = (
      <>
        <Button variant="subtle" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        {req.launchAfter && !steps.length && plan.data && (
          <Button variant="accent" icon={<Play size={14} />} onClick={startNow}>
            {t("fix.launch_now")}
          </Button>
        )}
        {steps.length > 0 && (
          <Button variant="accent" icon={<Wrench size={14} />} disabled={!chosen.length} onClick={() => void run()}>
            {req.launchAfter ? t("fix.run_launch", { n: chosen.length }) : t(chosen.length === 1 ? "fix.run_1" : "fix.run", { n: chosen.length })}
          </Button>
        )}
      </>
    );
  } else if (phase === "done" || phase === "undone") {
    footer = (
      <>
        {phase === "done" && report && canUndo(report) && (
          <Button variant="ghost" icon={<Undo2 size={14} />} onClick={() => void undo()}>
            {report.snapshot_id ? t("fix.undo") : t("fix.undo_settings")}
          </Button>
        )}
        <div className="flex-1" />
        {phase === "done" && (
          <Button variant="ghost" icon={<ShieldCheck size={14} />} loading={verify === "running"} onClick={() => void runVerify()}>
            {t("fix.verify.button")}
          </Button>
        )}
        {(req.launchAfter || (verify && verify !== "running")) && phase === "done" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button variant="accent" icon={<Play size={14} />} onClick={startNow}>
              {t("fix.launch_now")}
            </Button>
          </>
        ) : (
          <Button variant="accent" onClick={onClose}>
            {t("fix.close")}
          </Button>
        )}
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()} title={title} description={description} size="md" locked={busy} footer={footer}>
      {phase === "preview" ? (
        plan.isPending ? (
          <div className="flex flex-col gap-1.5">
            <div className="mb-1 flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={13} className="animate-spin" />
              {t("fix.scanning")}
            </div>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[58px]" />
            ))}
          </div>
        ) : plan.isError ? (
          <p className="selectable text-[13px] text-danger">{errorMessage(plan.error)}</p>
        ) : !steps.length && !plan.data.unfixable.length && !causes.length ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-card bg-ok/15 text-ok">
              <Check size={22} strokeWidth={2.5} />
            </span>
            <div className="text-[15px] font-semibold text-text">{t("fix.none.title")}</div>
            <p className="max-w-[400px] text-[13px] text-muted">{t("fix.none.text")}</p>
          </div>
        ) : (
          <PlanView
            plan={plan.data}
            instLoader={inst?.loader.kind}
            sel={sel}
            alt={alt}
            setSel={(id, v) => setSel((s) => ({ ...s, [id]: v }))}
            setAlt={(id, v) => setAlt((s) => ({ ...s, [id]: v }))}
            backup={backup}
            setBackup={changeBackup}
            instanceId={req.instanceId}
            crashReport={ignoreCrash ? null : req.crashReport}
          />
        )
      ) : busy ? (
        <div className="flex flex-col gap-3 py-4">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-text">
            <Wrench size={15} className="text-accent" />
            {phase === "undoing" ? t("fix.undoing") : t("fix.running")}
          </div>
          <Progress value={task?.progress ?? null} />
          <div className="min-h-[18px] truncate text-[12.5px] text-muted">{task?.message ?? ""}</div>
        </div>
      ) : report ? (
        <ReportView
          report={report}
          undone={phase === "undone"}
          plan={plan.data}
          instanceId={req.instanceId}
          crashReport={req.crashReport}
          verify={verify}
          onAgain={fixAgain}
        />
      ) : null}
    </Dialog>
  );
}

function PreLaunchDialog({ inst, q, resolve }: { inst: Instance; q: QuickCheck; resolve: (c: PreChoice) => void }) {
  const t = useT();
  const done = (c: PreChoice) => {
    if (c === "launch") skipLaunchCheck(inst.id, q.errors);
    useAutofix.setState({ pre: null });
    resolve(c);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && done("cancel")}
      title={t("fix.pre.title")}
      description={t(q.errors === 1 ? "fix.pre.text_1" : "fix.pre.text", { n: q.errors, name: inst.name })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => done("launch")}>
            {t("fix.pre.launch")}
          </Button>
          <Button variant="accent" icon={<Wrench size={14} />} onClick={() => done("fix")}>
            {t("fix.pre.fix")}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-2.5 rounded-ctl bg-surface px-3 py-2.5 text-[12.5px] text-muted">
        <Info size={14} className="mt-px shrink-0 text-dim" />
        {t("fix.pre.hint")}
      </div>
    </Dialog>
  );
}

export function AutofixHost() {
  const req = useAutofix((s) => s.req);
  const pre = useAutofix((s) => s.pre);
  return (
    <>
      {req && <AutofixDialog key={`${req.instanceId}:${req.crashReport ?? ""}`} req={req} onClose={() => useAutofix.setState({ req: null })} />}
      {pre && <PreLaunchDialog inst={pre.inst} q={pre.q} resolve={pre.resolve} />}
    </>
  );
}

/** Knopf „Probleme beheben“ (Hinweiszeile, Crash-Banner, Crash-Dialog). */
export function AutofixButton({
  req,
  size = "sm",
  variant = "accent",
  className,
  label,
}: {
  req: FixRequest;
  size?: "sm" | "md";
  variant?: "accent" | "ghost";
  className?: string;
  label?: string;
}) {
  const t = useT();
  return (
    <Button size={size} variant={variant} data-tour="autofix" icon={<Wrench size={13} />} className={className} onClick={() => openAutofix(req)}>
      {label ?? t("fix.button")}
    </Button>
  );
}
