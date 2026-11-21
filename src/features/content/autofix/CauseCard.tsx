import { AlertTriangle, FileWarning, UploadCloud } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { ReportProblemButton } from "@/features/feedback/FeedbackButtons";
import { Evidence, diagText } from "@/features/logs/Diagnosis";
import { uploadCrash } from "@/features/logs/LogsTab";
import { useT } from "@/i18n";
import type { Diagnosis, FixStep, Unfixable } from "@/lib/types";
import { unfixableText } from "./texts";

/** Nächster Schritt, wenn eine Ursache nicht automatisch lösbar ist. */
export function NextStep({ d, instanceId, crashReport, showHint = true }: { d: Diagnosis; instanceId: string; crashReport?: string | null; showHint?: boolean }) {
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


/** Eine Absturzursache: Erklärung, Fundstelle und die Schritte, die sie beheben. */
export function CauseCard({
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
