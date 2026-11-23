// Crash-Diagnose: Ergebnis von `crash_analyze` mit Schuldigem, Klartext und Aktionen.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileWarning, HelpCircle, MapPin, UploadCloud, Wrench } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { CrashAnalysis, Diagnosis, Instance } from "@/lib/types";
import { Button, Dialog, Skeleton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openShareLog } from "@/features/vibefix/shareStore";
import { openAutofix } from "@/features/content/autofixStore";
import { PixelIcon } from "@/components/ui/pixel/PixelIcon";
import { ActionButton } from "./components/ActionButton";
import { diagText, diagWhere } from "./diagnosisText";
import { AnalysisProgress } from "@/features/vibefix/AnalysisProgress";
import { EngineNote } from "@/features/vibefix/EngineNote";
import { SourceBadge } from "@/features/vibefix/SourceBadge";

export { diagText, diagWhere, localRange } from "./diagnosisText";

const analysisQuery = (instanceId: string, crashReport: string | null, exitCode: number | null, enabled: boolean) => ({
  queryKey: ["diagnose", instanceId, crashReport, exitCode],
  queryFn: () => api.crashAnalysis(instanceId, crashReport, exitCode),
  enabled,
  staleTime: 60_000,
});

export function useCrashAnalysis(instanceId: string, crashReport: string | null, exitCode: number | null, enabled = true) {
  return useQuery(analysisQuery(instanceId, crashReport, exitCode, enabled));
}

export function useDiagnosis(instanceId: string, crashReport: string | null, exitCode: number | null, enabled = true) {
  return useQuery({ ...analysisQuery(instanceId, crashReport, exitCode, enabled), select: (a: CrashAnalysis) => a.diagnoses });
}

/** Fundstelle mit der gefundenen Zeile. */
export function Evidence({ d, className }: { d: Diagnosis; className?: string }) {
  const t = useT();
  const where = diagWhere(d, t);
  if (!d.evidence && !where) return null;
  return (
    <div className={cn("mt-2 flex flex-col gap-1", className)}>
      {where && (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-dim">
          <MapPin size={11} className="shrink-0" />
          <span className="truncate">{where}</span>
        </span>
      )}
      {d.evidence && (
        <pre className="selectable overflow-hidden text-ellipsis whitespace-pre-wrap break-all rounded-xs bg-black/20 px-2 py-1 font-mono text-[11px] leading-snug text-muted">{d.evidence}</pre>
      )}
    </div>
  );
}

export function DiagnosisCard({ d, inst, crashReport, compact }: { d: Diagnosis; inst: Instance; crashReport: string | null; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { title, text } = diagText(d, t);
  const Icon = d.id === "unknown" ? HelpCircle : FileWarning;
  const onDone = () => {
    qc.invalidateQueries({ queryKey: ["diagnose", inst.id] });
    qc.invalidateQueries({ queryKey: qk.content(inst.id, "mod") });
  };
  return (
    <div className={cn("flex flex-col gap-2", !compact && "rounded-card bg-surface p-3.5")}>
      <div className="flex items-start gap-2.5">
        <Icon size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold text-text">{title}</span>
            <SourceBadge d={d} />
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{text}</p>
          {d.culprit?.file && (
            <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-xs bg-white/[.05] px-2 py-0.5 text-[12px]">
              <span className="text-dim">{t("diag.file")}</span>
              <span className="truncate font-mono text-text">{d.culprit.file}</span>
            </div>
          )}
          {!compact && <Evidence d={d} />}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-[26px]">
        {d.actions.map((a, n) => (
          <ActionButton key={n} a={a} inst={inst} crashReport={crashReport} onDone={onDone} />
        ))}
      </div>
    </div>
  );
}

/** Dialog mit allen Diagnosen (Logs-Tab, „Details“ im Crash-Banner). */
export function DiagnosisDialog({
  inst,
  crashReport,
  exitCode,
  open,
  onOpenChange,
}: {
  inst: Instance;
  crashReport: string | null;
  exitCode: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const q = useCrashAnalysis(inst.id, crashReport, exitCode, open);
  const list = q.data?.diagnoses;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("diag.title")}
      description={t("diag.desc")}
      size="lg"
      footer={
        inst.loader.kind !== "vanilla" || (list?.length ?? 0) > 0 ? (
          <Button
            variant="accent"
            icon={<Wrench size={14} />}
            onClick={() => {
              onOpenChange(false);
              openAutofix({ instanceId: inst.id, crashReport, exitCode });
            }}
          >
            {t("fix.button")}
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <AnalysisProgress />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : q.isError ? (
        <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>
      ) : !list?.length ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <PixelIcon name="shield" className="text-muted" />
          <div className="text-[15px] font-semibold text-text">{t("diag.none.title")}</div>
          <p className="max-w-[440px] text-[13px] text-muted">{t("diag.none.text")}</p>
          <Button size="sm" className="mt-2" icon={<UploadCloud size={13} />} onClick={() => openShareLog(inst.id, crashReport)}>
            {t("logs.upload")}
          </Button>
          <EngineNote info={q.data?.info} className="mt-2" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <EngineNote info={q.data?.info} />
          {list.map((d, n) => (
            <DiagnosisCard key={n} d={d} inst={inst} crashReport={crashReport} />
          ))}
        </div>
      )}
    </Dialog>
  );
}
