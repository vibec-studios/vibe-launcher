import { BrainCircuit, Info } from "lucide-react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { AnalysisInfo } from "@/lib/types";

export function EngineNote({ info, className }: { info?: AnalysisInfo | null; className?: string }) {
  const t = useT();
  if (!info) return null;
  if (info.engine === "vibefix") {
    return (
      <div className={cn("flex items-center gap-1.5 text-[11.5px] text-dim", className)}>
        <BrainCircuit size={12} className="shrink-0 text-accent" />
        <span>{t("vibefix.engine.model", { version: info.model_version ?? "?" })}</span>
      </div>
    );
  }
  if (!info.notice) return null;
  return (
    <div className={cn("flex items-center gap-1.5 text-[11.5px] text-dim", className)}>
      <Info size={12} className="shrink-0" />
      <span>{t(`vibefix.engine.${info.notice}`)}</span>
    </div>
  );
}
