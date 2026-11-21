import { CircleSlash, Hourglass, LogOut, Sparkles } from "lucide-react";
import { Button, SettingsCard, Spinner, confirm, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatDate } from "@/lib/format";
import { errText } from "@/features/social/service";
import { BetaWhy } from "./BetaNote";
import { JoinWaitlistButton } from "./JoinDialog";
import { leaveWaitlist, useVibeAccess, type AccessView } from "./store";
import type { AccessInfo } from "./types";

function StateTag({ status }: { status: AccessView }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-pill px-2 text-caption font-semibold",
        status === "waitlist" ? "bg-brand/10 text-brand" : status === "rejected" ? "bg-danger/10 text-danger" : "bg-surface2 text-muted",
      )}
    >
      {status === "unknown" ? <Spinner size={9} /> : <span className={cn("h-1.5 w-1.5 rounded-dot", status === "waitlist" ? "bg-brand" : status === "rejected" ? "bg-danger" : "bg-dim")} />}
      {t(`access.state.${status}`)}
    </span>
  );
}

function Row({ icon, title, children, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-surface2 text-dim">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight text-text">{title}</div>
        <div className="mt-1 flex flex-col gap-1 text-[12.5px] leading-relaxed text-muted">{children}</div>
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

function WaitProgress({ info }: { info: AccessInfo | null }) {
  const t = useT();
  if (!info?.position || !info.total) return <span className="text-dim">{t("access.wait.position_unknown")}</span>;
  const ahead = Math.max(0, Math.min(1, 1 - (info.position - 1) / Math.max(info.total, 1)));
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <span className="text-[13px] font-semibold tabular-nums text-brand">{t("access.wait.position", { pos: info.position, total: info.total })}</span>
      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-pill bg-surface2">
        <div className="h-full rounded-pill bg-brand" style={{ width: `${Math.round(ahead * 100)}%` }} />
      </div>
    </div>
  );
}

export function AccessCard() {
  const t = useT();
  const status = useVibeAccess((s) => s.status);
  const info = useVibeAccess((s) => s.info);
  const busy = useVibeAccess((s) => s.busy);
  if (status === "approved") return null;

  const leave = async () => {
    const ok = await confirm({ title: t("access.wait.leave_title"), text: t("access.wait.leave_text"), confirmLabel: t("access.wait.leave"), danger: true });
    if (!ok) return;
    try {
      await leaveWaitlist();
      toast.info(t("access.wait.left"));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  let body: React.ReactNode;
  if (status === "waitlist") {
    body = (
      <Row
        icon={<Hourglass size={18} />}
        title={t("access.wait.title")}
        action={
          <Button size="sm" variant="ghost" icon={<LogOut size={14} />} loading={busy} onClick={() => void leave()}>
            {t("access.wait.leave")}
          </Button>
        }
      >
        <WaitProgress info={info} />
        {info?.requestedAt && <span className="text-dim">{t("access.wait.since", { date: formatDate(info.requestedAt) })}</span>}
        <span>{t("access.wait.text")}</span>
      </Row>
    );
  } else if (status === "rejected") {
    body = (
      <Row icon={<CircleSlash size={18} />} title={t("access.rejected.title")} action={<JoinWaitlistButton label={t("access.rejected.retry")} />}>
        <span>{t("access.rejected.text")}</span>
        {info?.reason && <span className="text-text">{t("access.rejected.reason", { reason: info.reason })}</span>}
        {info?.decidedAt && <span className="text-dim">{t("access.rejected.on", { date: formatDate(info.decidedAt) })}</span>}
      </Row>
    );
  } else if (status === "none") {
    body = (
      <Row icon={<Sparkles size={18} />} title={t("access.none.title")} action={<JoinWaitlistButton />}>
        <span>{t("access.none.text")}</span>
      </Row>
    );
  } else {
    body = (
      <div className="flex items-center gap-2.5 px-4 py-3.5 text-[12.5px] text-muted">
        <Spinner size={13} />
        {t("access.checking")}
      </div>
    );
  }

  return (
    <SettingsCard title={t("access.card.title")} right={<StateTag status={status} />}>
      {body}
      <BetaWhy className="border-t border-line px-4 py-3" />
    </SettingsCard>
  );
}
