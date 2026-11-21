import { Info } from "lucide-react";
import { Tag, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function BetaBadge({ className }: { className?: string }) {
  const t = useT();
  return <Tag className={cn("h-[18px] px-1.5 text-[10.5px] font-semibold uppercase tracking-wide", className)}>{t("access.beta")}</Tag>;
}

export function BetaWhy({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex items-start gap-2.5 text-[12px] leading-relaxed text-dim", className)}>
      <Info size={13} className="mt-0.5 shrink-0" />
      <p>
        <span className="font-medium text-muted">{t("access.why.title")}</span> {t("access.why.text")}
      </p>
    </div>
  );
}
