import { useState } from "react";
import { AlertTriangle, FileText, Stethoscope, UploadCloud, X } from "lucide-react";
import { useGameState } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { Button, IconButton, cn } from "@/components/ui";
import { showLogFile, uploadCrash } from "@/features/logs/LogsTab";
import { useT } from "@/i18n";
import { DiagnosisCard, DiagnosisDialog, diagText, useDiagnosis } from "@/features/logs/Diagnosis";
import { AutofixButton } from "@/features/content/AutoFix";
import { ReportProblemButton } from "@/features/feedback/FeedbackButtons";
import { useSimple } from "@/lib/mode";
import { HelpLink } from "@/features/help/HelpButton";
import { route, wrap } from "./route";

export function CrashBanner({ instance }: { instance: Instance }) {
  const t = useT();
  const nav = route.useNavigate();
  const game = useGameState(instance.id);
  const key = game?.crashed && game.state === "stopped" ? `${game.started_at}:${game.exit_code}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const crashReport = game?.crash_report ?? null;
  const diag = useDiagnosis(instance.id, crashReport, game?.exit_code ?? null, !!key && dismissed !== key);
  const top = diag.data?.[0];
  const simple = useSimple();
  if (!key || dismissed === key) return null;
  if (simple) {
    // Simple: verständliche Meldung mit „Beheben“ – keine Exit-Codes, Dateinamen, Logs
    return (
      <div data-tour="crash-banner" className="shrink-0 bg-danger/[.08] shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-danger)_25%,transparent)] animate-fade-in">
        <div className={cn(wrap, "flex items-center gap-3 py-3")}>
          <AlertTriangle size={18} className="shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-text">{t("simple.crash.title")}</div>
            <div className="text-[12.5px] text-muted">{t("simple.crash.text")}</div>
          </div>
          <AutofixButton req={{ instanceId: instance.id, crashReport, exitCode: game?.exit_code ?? null, launchAfter: true }} size="md" label={t("crash.offer.fix")} />
          <ReportProblemButton instanceId={instance.id} size="md" />
          <HelpLink guide="autofix" />
          <IconButton label={t("common.close")} size="sm" className="border-transparent" onClick={() => setDismissed(key)}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
    );
  }
  // „Absturz erkannt – automatisch beheben?“: wahrscheinlichste Ursache gleich nennen
  const found = diag.data?.filter((d) => d.id !== "exit_code") ?? [];
  const offer = found.length
    ? t(found.length === 1 ? "crash.offer.text_1" : "crash.offer.text", { n: found.length, title: diagText(found[0], t).title })
    : diag.data
      ? t("crash.offer.none")
      : null;
  return (
    <div data-tour="crash-banner" className="shrink-0 bg-danger/[.08] shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-danger)_25%,transparent)] animate-fade-in">
      <div className={cn(wrap, "flex items-start gap-3 py-3")}>
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text">{t("crash.offer.title")}</div>
            <div className="text-[12.5px] leading-relaxed text-muted" title={game?.crash_report?.split(/[\/]/).pop()}>
              {offer ?? (game?.exit_code != null ? t("inst.crash.code", { code: game.exit_code }) : t("inst.crash.text"))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AutofixButton req={{ instanceId: instance.id, crashReport, exitCode: game?.exit_code ?? null }} label={t("crash.offer.fix")} />
            <Button size="sm" icon={<Stethoscope size={13} />} onClick={() => setDetails(true)}>
              {t("diag.open")}
              {diag.data && diag.data.length > 0 && <span className="text-[12px] text-muted">{diag.data.length}</span>}
            </Button>
            <Button
              size="sm"
              icon={<FileText size={13} />}
              onClick={() => {
                if (game?.crash_report) showLogFile(instance.id, game.crash_report);
                nav({ search: { tab: "logs" } });
              }}
            >
              {t("inst.crash.logs")}
            </Button>
            <span className="mx-1 h-5 w-px bg-line max-[900px]:hidden" aria-hidden />
            <Button
              size="sm"
              variant="subtle"
              loading={busy}
              icon={<UploadCloud size={13} />}
              onClick={async () => {
                setBusy(true);
                await uploadCrash(instance.id, game?.crash_report ?? null);
                setBusy(false);
              }}
            >
              {t("logs.upload")}
            </Button>
            <ReportProblemButton instanceId={instance.id} />
            <HelpLink guide="autofix" />
          </div>
        </div>
        <IconButton label={t("common.close")} size="sm" className="-mt-0.5 border-transparent" onClick={() => setDismissed(key)}>
          <X size={15} />
        </IconButton>
      </div>
      {top && (
        <div className={cn(wrap, "pb-3")}>
          <DiagnosisCard d={top} inst={instance} crashReport={crashReport} compact />
        </div>
      )}
      <DiagnosisDialog inst={instance} crashReport={crashReport} exitCode={game?.exit_code ?? null} open={details} onOpenChange={setDetails} />
    </div>
  );
}
