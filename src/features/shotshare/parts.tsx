import { Globe, Link2, Lock, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ChoiceCard, ChoiceGrid, Select, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format";
import type { ScreenshotList, ScreenshotVisibility } from "@/lib/vibe-sdk";

export const VISIBILITIES: ScreenshotVisibility[] = ["private", "friends", "link"];

export function visIcon(v: ScreenshotVisibility, size = 18): ReactNode {
  if (v === "private") return <Lock size={size} />;
  if (v === "friends") return <Users size={size} />;
  return <Link2 size={size} />;
}

export function VisibilityCards({ value, onChange }: { value: ScreenshotVisibility; onChange: (v: ScreenshotVisibility) => void }) {
  const t = useT();
  return (
    <ChoiceGrid columns={3}>
      {VISIBILITIES.map((v) => (
        <ChoiceCard key={v} icon={visIcon(v, 20)} title={t(`shotshare.vis.${v}`)} text={t(`shotshare.vis.${v}.desc`)} selected={value === v} onClick={() => onChange(v)} />
      ))}
    </ChoiceGrid>
  );
}

export function VisibilitySelect({ value, onChange, disabled }: { value: ScreenshotVisibility; onChange: (v: ScreenshotVisibility) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Select<ScreenshotVisibility>
      size="sm"
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={VISIBILITIES.map((v) => ({ value: v, label: t(`shotshare.vis.${v}`) }))}
    />
  );
}

export function QuotaBar({ list, className }: { list: ScreenshotList | undefined; className?: string }) {
  const t = useT();
  if (!list) return null;
  const pct = list.quotaBytes ? Math.min(100, (list.usedBytes / list.quotaBytes) * 100) : 0;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="font-medium text-text">{t("shotshare.quota.title")}</span>
        <span className="tabular-nums text-muted">{t("shotshare.quota.used", { used: formatBytes(list.usedBytes), max: formatBytes(list.quotaBytes) })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-surface3">
        <div className={cn("h-full rounded-pill", pct > 90 ? "bg-danger" : pct > 70 ? "bg-warn" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[12px] text-dim">{t("shotshare.quota.hint", { max: formatBytes(list.maxUploadBytes) })}</p>
    </div>
  );
}

export function VisBadge({ v }: { v: ScreenshotVisibility }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-black/60 px-2 py-0.5 text-[11px] font-medium text-[#fff]">
      {v === "link" ? <Globe size={11} /> : visIcon(v, 11)}
      {t(`shotshare.vis.${v}`)}
    </span>
  );
}
