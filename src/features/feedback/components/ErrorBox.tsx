import { AlertTriangle, WifiOff } from "lucide-react";
import type { FeedbackSendResult } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

export function ErrorBox({ r }: { r: FeedbackSendResult }) {
  const t = useT();
  let text = "";
  let icon = <AlertTriangle size={15} className="mt-px shrink-0" />;
  if (r.status === "offline") {
    text = t("fb.err.offline");
    icon = <WifiOff size={15} className="mt-px shrink-0" />;
  } else if (r.status === "rate_limited") {
    const mins = r.retry_after_secs ? Math.ceil(r.retry_after_secs / 60) : 0;
    text = t("fb.err.rate", { time: mins > 1 ? t("fb.err.rate_min", { n: mins }) : t("fb.err.rate_soon") });
  } else if (r.status === "rejected") {
    if (r.http === 413) text = t("fb.err.too_large");
    else if (r.http >= 500 || r.http === 0) text = t("fb.err.server", { code: r.http || "–" });
    else text = t("fb.err.rejected", { msg: r.message ?? `HTTP ${r.http}` });
  }
  return (
    <div role="alert" className={cn("flex items-start gap-2.5 rounded-card px-3.5 py-2.5 text-[12.5px]", r.status === "rate_limited" ? "bg-warn/10 text-warn" : "bg-danger/[.08] text-danger")}>
      {icon}
      <span className="text-text">{text}</span>
    </div>
  );
}
