import { Hourglass } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openSettings } from "@/features/settings/store";
import { BetaBadge } from "./BetaNote";
import { useAccessLine } from "./hooks";
import { JoinWaitlistButton } from "./JoinDialog";
import { useVibeAccess } from "./store";

export function AccessStrip({ className }: { className?: string }) {
  const t = useT();
  const status = useVibeAccess((s) => s.status);
  const line = useAccessLine();
  if (!line) return null;
  return (
    <div className={cn("flex shrink-0 items-center gap-3 rounded-card bg-surface px-4 py-2", className)}>
      <Hourglass size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
          {status === "waitlist" ? t("access.wait.title") : status === "rejected" ? t("access.rejected.title") : t("access.none.title")}
          <BetaBadge />
        </div>
        <div className="text-[12px] leading-snug text-muted">{line}</div>
      </div>
      <div className="shrink-0">
        {status === "waitlist" ? (
          <Button size="sm" onClick={() => openSettings("vibe")}>
            {t("access.show_status")}
          </Button>
        ) : (
          <JoinWaitlistButton label={status === "rejected" ? t("access.rejected.retry") : undefined} />
        )}
      </div>
    </div>
  );
}
