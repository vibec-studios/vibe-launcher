import { useState } from "react";
import { AlertTriangle, Stethoscope, X } from "lucide-react";
import { useGameState } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { Button, IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { DiagnosisDialog } from "@/features/logs/Diagnosis";
import { wrap } from "./route";

export function CrashBanner({ instance }: { instance: Instance }) {
  const t = useT();
  const game = useGameState(instance.id);
  const key = game?.crashed && game.state === "stopped" ? `${game.started_at}:${game.exit_code}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  if (!key || dismissed === key) return null;
  return (
    <div data-tour="crash-banner" className="shrink-0 bg-danger/[.08] shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-danger)_25%,transparent)] animate-fade-in">
      <div className={cn(wrap, "flex items-center gap-3 py-2.5")}>
        <AlertTriangle size={16} className="shrink-0 text-danger" />
        <div className="min-w-0 flex-1 text-[13.5px] font-semibold text-text">{t("crash.min.title")}</div>
        <Button size="sm" variant="subtle" icon={<Stethoscope size={13} />} onClick={() => setDetails(true)}>
          {t("crash.min.diagnose")}
        </Button>
        <IconButton label={t("common.close")} size="sm" className="border-transparent" onClick={() => setDismissed(key)}>
          <X size={15} />
        </IconButton>
      </div>
      <DiagnosisDialog inst={instance} crashReport={game?.crash_report ?? null} exitCode={game?.exit_code ?? null} open={details} onOpenChange={setDetails} />
    </div>
  );
}
