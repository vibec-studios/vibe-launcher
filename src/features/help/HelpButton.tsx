import { CircleHelp } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openHelp } from "./store";
import type { GuideId } from "./types";

export function HelpButton() {
  const t = useT();
  return (
    <Tooltip content={t("help.title")} side="bottom">
      <button
        aria-label={t("help.title")}
        data-tour="help"
        data-testid="help-open"
        onClick={() => openHelp()}
        className="grid h-8 w-8 place-items-center rounded-ctl text-muted transition-colors duration-100 hover:bg-white/[.06] hover:text-text"
      >
        <CircleHelp size={16} />
      </button>
    </Tooltip>
  );
}

export function HelpLink({ guide, className, label }: { guide: GuideId; className?: string; label?: string }) {
  const t = useT();
  const text = label ?? t("help.link");
  return (
    <Tooltip content={text}>
      <button
        type="button"
        aria-label={text}
        data-help-link={guide}
        onClick={(e) => {
          e.stopPropagation();
          openHelp(guide);
        }}
        className={cn(
          "inline-grid h-6 w-6 shrink-0 place-items-center rounded-pill text-dim transition-colors duration-100 hover:bg-white/[.07] hover:text-text",
          className,
        )}
      >
        <CircleHelp size={14} />
      </button>
    </Tooltip>
  );
}
