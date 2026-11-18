// Kennzeichnung für CurseForge-Projekte, deren Autor keine Downloads über andere Launcher erlaubt
// (`allowModDistribution == false`): kleines, flaches Etikett mit Erklärung im Tooltip.
import { Hand } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function ManualBadge({
  short,
  iconOnly,
  solid,
  tip,
  className,
}: {
  short?: boolean;
  iconOnly?: boolean;
  /** Deckender Hintergrund (über Bildern) */
  solid?: boolean;
  tip?: string;
  className?: string;
}) {
  const t = useT();
  const label = short ? t("manual.badge_short") : t("manual.badge");
  return (
    <Tooltip content={<span className="block max-w-[280px] leading-snug">{tip ?? t("manual.tip")}</span>}>
      <span
        aria-label={t("manual.badge")}
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-xs font-semibold text-warn",
          solid ? "bg-overlay" : "bg-warn/[.12]",
          iconOnly ? "w-5 justify-center" : "px-1.5 text-[11px]",
          className,
        )}
      >
        <Hand size={11} strokeWidth={2.25} />
        {!iconOnly && label}
      </span>
    </Tooltip>
  );
}
