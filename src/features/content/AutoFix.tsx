// „Probleme beheben“ in einem Klick: Plan laden (Abhängigkeiten, Konflikte, letzte Crash-Analyse), Vorschau
// („Das wird gemacht“) mit abwählbaren Schritten, ausführen (vorher Snapshot) und Zusammenfassung mit „Rückgängig“.
// Außerdem die Rückfrage vor dem Start („Trotzdem starten“ / „Beheben und starten“). Global eingebunden (InstanceDialogs).
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  Cpu,
  Download,
  ExternalLink,
  Info,
  MemoryStick,
  PackageCheck,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  ShieldCheck,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Button, Checkbox, Dialog, Progress, Skeleton, cn, confirm, toast } from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, useInstances, useSettings, useTaskStore, waitForTask } from "@/lib/queries";
import { patchSettings } from "@/lib/mode";
import { DEFAULT_FIX_BACKUP, FixBackupPicker, useScopeList } from "@/features/backups/FixBackupPicker";
import { loaderNames } from "@/lib/format";
import type { FixAction, FixBackup, FixPlan, FixReport, FixStep, Instance, LoaderKind, QuickCheck } from "@/lib/types";

// ------------------------------------------------------------------ Store

export interface FixRequest {
  instanceId: string;
  /** Ausdrücklich gewählter Absturz (Crash-Banner/-Dialog) */
  crashReport?: string | null;
  exitCode?: number | null;
  /** Nach dem Beheben „Jetzt starten“ anbieten */
  launchAfter?: boolean;
}

type PreChoice = "fix" | "launch" | "cancel";

interface AutofixStore {
  req: FixRequest | null;
  pre: { inst: Instance; q: QuickCheck; resolve: (c: PreChoice) => void } | null;
}

const useAutofix = create<AutofixStore>(() => ({ req: null, pre: null }));

export function openAutofix(req: FixRequest) {
  useAutofix.setState({ req });
}

/** Rückfrage vor dem Start, wenn bekannte Probleme vorliegen. */
export function askBeforeLaunch(inst: Instance, q: QuickCheck): Promise<PreChoice> {
  return new Promise((resolve) => useAutofix.setState({ pre: { inst, q, resolve } }));
}

/** „Trotzdem starten“ gilt für diese Sitzung, solange sich die Zahl der Probleme nicht ändert. */
const skipped = new Map<string, number>();
export function launchCheckSkipped(id: string, errors: number) {
  return skipped.get(id) === errors;
}

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
  }
}

function stepSub(s: FixStep, t: ReturnType<typeof useT>, instLoader?: LoaderKind): string {
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
  if (s.from_crash) parts.push(t("fix.from_crash"));
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
}: {
  s: FixStep;
  on: boolean;
  alt: boolean;
  onToggle: (v: boolean) => void;
  onAlt: (v: boolean) => void;
  instLoader?: LoaderKind;
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
        <div className="mt-0.5 text-[12px] leading-snug text-dim">{stepSub(s, t, instLoader)}</div>
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

function PlanView({
  plan,
  sel,
  alt,
  setSel,
  setAlt,
  instLoader,
  backup,
  setBackup,
}: {
  plan: FixPlan;
  instLoader?: LoaderKind;
  backup: FixBackup;
  setBackup: (b: FixBackup) => void;
  sel: Record<string, boolean>;
  alt: Record<string, boolean>;
  setSel: (id: string, v: boolean) => void;
  setAlt: (id: string, v: boolean) => void;
}) {
  const t = useT();
  // Loader-Schritte als eigener Abschnitt: betreffen die ganze Instanz, nicht einzelne Mods
  const isLoader = (s: FixStep) => s.action.kind === "set_loader" || s.action.kind === "repair_loader";
  const loader = plan.steps.filter(isLoader);
  const normal = plan.steps.filter((s) => !s.confirm && !isLoader(s));
  const ask = plan.steps.filter((s) => s.confirm && !isLoader(s));
  const manual = plan.steps.some((s) => s.action.kind === "replace" && s.action.manual);
  const loaderChange = plan.steps.some((s) => s.action.kind === "set_loader");
  const row = (s: FixStep) => (
    <StepRow key={s.id} s={s} on={!!sel[s.id]} alt={!!alt[s.id]} onToggle={(v) => setSel(s.id, v)} onAlt={(v) => setAlt(s.id, v)} instLoader={instLoader} />
  );
  return (
    <div className="flex flex-col gap-4">
      {loader.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.loader.title")}</h3>
          {loader.map(row)}
        </section>
      )}
      {normal.length > 0 && (
        <section className="flex flex-col gap-1.5">
          {loader.length > 0 && <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.mods.title")}</h3>}
          {normal.map(row)}
        </section>
      )}
      {ask.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.ask_title")}</h3>
          <p className="-mt-1 mb-0.5 text-[12px] text-dim">{t("fix.ask_text")}</p>
          {ask.map(row)}
        </section>
      )}
      {plan.unfixable.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.unfixable.title")}</h3>
          {plan.unfixable.map((u, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-1.5 text-[12.5px] text-muted">
              <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />
              <span className="selectable min-w-0">{t(`fix.unfixable.${u.reason}`, { name: u.name, detail: u.detail ?? "" })}</span>
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

/** Lässt sich etwas zurückstellen? Ohne Sicherung nur Java/RAM, Loader und vorgemerkte Downloads (wie `can_undo`). */
function canUndo(r: FixReport) {
  return !!r.snapshot_id || !!r.prev_java || !!r.prev_loader || r.manual.length > 0;
}

function ReportView({ report, undone, steps }: { report: FixReport; undone: boolean; steps: FixStep[] }) {
  const t = useT();
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
    </div>
  );
}

function AutofixDialog({ req, onClose }: { req: FixRequest; onClose: () => void }) {
  const t = useT();
  const { launch } = useInstanceActions();
  const { data: instances } = useInstances();
  const inst = instances?.find((i) => i.id === req.instanceId) ?? null;
  const plan = useQuery({
    queryKey: ["autofix-plan", req.instanceId, req.crashReport ?? null, req.exitCode ?? null],
    queryFn: () => api.autofixPlan(req.instanceId, req.crashReport, req.exitCode),
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

  const startNow = () => {
    onClose();
    if (inst) void launch(inst, null, null, { skipCheck: true });
  };

  const busy = phase === "running" || phase === "undoing";
  const steps = plan.data?.steps ?? [];
  const title = phase === "done" ? t("fix.done.title") : phase === "undone" ? t("fix.undone.title") : t("fix.title");
  const description =
    phase === "preview"
      ? plan.data && (steps.length || plan.data.unfixable.length)
        ? t(plan.data.crash ? "fix.desc_crash" : "fix.desc", { name: inst?.name ?? "" })
        : undefined
      : undefined;

  let footer: ReactNode = null;
  if (phase === "preview") {
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
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
        {req.launchAfter && phase === "done" ? (
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
        ) : !steps.length && !plan.data.unfixable.length ? (
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
        <ReportView report={report} undone={phase === "undone"} steps={plan.data?.steps ?? []} />
      ) : null}
    </Dialog>
  );
}

function PreLaunchDialog({ inst, q, resolve }: { inst: Instance; q: QuickCheck; resolve: (c: PreChoice) => void }) {
  const t = useT();
  const done = (c: PreChoice) => {
    if (c === "launch") skipped.set(inst.id, q.errors);
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
export function AutofixButton({ req, size = "sm", variant = "accent", className }: { req: FixRequest; size?: "sm" | "md"; variant?: "accent" | "ghost"; className?: string }) {
  const t = useT();
  return (
    <Button size={size} variant={variant} icon={<Wrench size={13} />} className={className} onClick={() => openAutofix(req)}>
      {t("fix.button")}
    </Button>
  );
}
