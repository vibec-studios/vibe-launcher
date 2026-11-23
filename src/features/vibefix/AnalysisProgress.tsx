import { BrainCircuit, RefreshCw } from "lucide-react";
import { Progress, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { isModelPhase, phasePercent, useAnalysisPhase } from "./useAnalysisPhase";

export function AnalysisProgress({ idle, compact, className }: { idle?: string; compact?: boolean; className?: string }) {
  const t = useT();
  const status = useAnalysisPhase();
  const model = isModelPhase(status);
  const pct = phasePercent(status);
  const text = model
    ? pct !== null
      ? t("vibefix.phase.download", { pct })
      : t("vibefix.phase.model")
    : status?.phase === "analyzing"
      ? t("vibefix.phase.analyze")
      : (idle ?? t("vibefix.phase.analyze"));
  const Icon = model ? BrainCircuit : RefreshCw;
  return (
    <div className={cn("flex flex-col gap-1.5", className)} aria-live="polite">
      <div className={cn("flex items-center gap-2 text-muted", compact ? "text-[12px]" : "text-[13px]")}>
        <Icon size={compact ? 12 : 13} className={cn("shrink-0", model ? "text-accent" : "animate-spin")} />
        <span className="truncate">{text}</span>
      </div>
      {model && !compact && <Progress value={pct} className="max-w-[320px]" />}
    </div>
  );
}
