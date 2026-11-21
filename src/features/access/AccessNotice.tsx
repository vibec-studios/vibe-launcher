import { CircleSlash, Hourglass, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openSettings } from "@/features/settings/store";
import { BetaWhy } from "./BetaNote";
import { JoinWaitlistButton } from "./JoinDialog";
import { useVibeAccess } from "./store";

export function AccessNotice({ compact, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const status = useVibeAccess((s) => s.status);
  const info = useVibeAccess((s) => s.info);
  const box = cn("flex h-full flex-col items-center justify-center gap-3 px-6 text-center", compact ? "py-8" : "py-16", className);
  const icon = (n: ReactNode) => <div className="text-dim">{n}</div>;
  const title = "text-[15px] font-semibold text-text";
  const text = "max-w-sm text-[13px] leading-relaxed text-muted";
  const why = !compact && <BetaWhy className="mt-2 max-w-sm text-left" />;

  if (status === "waitlist") {
    return (
      <div className={box}>
        {icon(<Hourglass size={22} />)}
        <h3 className={title}>{t("access.wait.title")}</h3>
        <p className="text-[13px] font-semibold tabular-nums text-brand">
          {info?.position && info.total ? t("access.wait.position", { pos: info.position, total: info.total }) : t("access.wait.position_unknown")}
        </p>
        <p className={text}>{t("access.wait.text")}</p>
        <Button size="sm" onClick={() => openSettings("vibe")}>
          {t("access.show_status")}
        </Button>
        {why}
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className={box}>
        {icon(<CircleSlash size={22} />)}
        <h3 className={title}>{t("access.rejected.title")}</h3>
        <p className={text}>{t("access.rejected.text")}</p>
        {info?.reason && <p className="max-w-sm text-[12.5px] text-muted">{t("access.rejected.reason", { reason: info.reason })}</p>}
        <JoinWaitlistButton label={t("access.rejected.retry")} />
        {why}
      </div>
    );
  }
  if (status === "none") {
    return (
      <div className={box}>
        {icon(<Sparkles size={22} />)}
        <h3 className={title}>{t("access.none.title")}</h3>
        <p className={text}>{t("access.none.text")}</p>
        <JoinWaitlistButton />
        {why}
      </div>
    );
  }
  return (
    <div className={box}>
      <Spinner size={18} className="text-muted" />
      <p className="text-[13px] text-muted">{t("access.checking")}</p>
    </div>
  );
}
