import { useRouterState } from "@tanstack/react-router";
import { MessageSquareWarning } from "lucide-react";
import { Button, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { openFeedback } from "./store";

/** Knopf in der Titelleiste (auch im Simple-Modus). Wählt die Instanz der aktuellen Seite vor. */
export function FeedbackButton() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const instId = path.startsWith("/instances/") ? decodeURIComponent(path.split("/")[2] ?? "") : null;
  return (
    <Tooltip content={t("fb.button")} side="bottom">
      <button
        aria-label={t("fb.button")}
        data-testid="fb-open"
        data-tour="feedback"
        onClick={() => void openFeedback({ source: "button", ...(instId ? { instanceId: instId } : {}) })}
        className="grid h-8 w-8 place-items-center rounded-ctl text-muted transition-colors duration-100 hover:bg-white/[.06] hover:text-text"
      >
        <MessageSquareWarning size={16} />
      </button>
    </Tooltip>
  );
}

/** „Problem melden“ (Absturzanzeige, Autofix): öffnet den Dialog mit Instanz + Logs. */
export function ReportProblemButton({ instanceId, source = "crash", size = "sm" }: { instanceId: string; source?: "crash" | "autofix"; size?: "sm" | "md" }) {
  const t = useT();
  return (
    <Button size={size} variant="subtle" icon={<MessageSquareWarning size={13} />} onClick={() => void openFeedback({ kind: "bug", instanceId, attachLogs: true, source })}>
      {t("fb.crash.report")}
    </Button>
  );
}
