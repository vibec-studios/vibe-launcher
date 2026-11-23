import { useQuery } from "@tanstack/react-query";
import { Check, Play, ShieldCheck, Undo2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Dialog, Progress, Skeleton, confirm, toast } from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { DEFAULT_FIX_BACKUP } from "@/features/backups/FixBackupPicker";
import { AnalysisProgress } from "@/features/vibefix/AnalysisProgress";
import { EngineNote } from "@/features/vibefix/EngineNote";
import { useT } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { patchSettings } from "@/lib/mode";
import { qk, queryClient, useInstances, useSettings, useTaskStore, waitForTask } from "@/lib/queries";
import type { FixBackup, FixReport } from "@/lib/types";
import type { FixRequest } from "../autofixStore";
import { PlanView } from "./PlanView";
import { ReportView } from "./ReportView";
import { canUndo, type Verify } from "./status";

export type Phase = "preview" | "running" | "done" | "undoing" | "undone";


export function AutofixDialog({ req, onClose }: { req: FixRequest; onClose: () => void }) {
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
            <AnalysisProgress idle={t("fix.scanning")} className="mb-1" />
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
            <EngineNote info={plan.data.analysis} className="mt-1" />
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
