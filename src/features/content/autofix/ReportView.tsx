import { AlertTriangle, Check, ExternalLink, Play, RefreshCw, Undo2, Wrench, X } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { useScopeList } from "@/features/backups/FixBackupPicker";
import { diagText } from "@/features/logs/Diagnosis";
import { useT } from "@/i18n";
import type { FixAction, FixPlan, FixReport } from "@/lib/types";
import { NextStep } from "./CauseCard";
import { canUndo, causeStatus, statusStyle, type Verify } from "./status";
import { actionText } from "./texts";

export function VerifyView({ v, onAgain }: { v: Verify; onAgain: () => void }) {
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

export function ReportView({
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
