import { Ban, DoorOpen, LogIn, LogOut, Radio, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import type { HostSessionEvent, HostSessionEventType } from "@/lib/vibe-sdk";
import { Skeleton, cn } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { useT } from "@/i18n";
import { useHostEvents } from "./api";

const ICON: Record<HostSessionEventType, React.ReactNode> = {
  join: <LogIn size={13} />,
  leave: <LogOut size={13} />,
  kick: <DoorOpen size={13} />,
  unkick: <Undo2 size={13} />,
  role: <ShieldCheck size={13} />,
  privacy: <ShieldAlert size={13} />,
  denied: <Ban size={13} />,
};

const TONE: Partial<Record<HostSessionEventType, string>> = { join: "text-ok", kick: "text-danger", denied: "text-warn" };

function text(e: HostSessionEvent, t: ReturnType<typeof useT>) {
  const name = e.player?.name ?? "?";
  const actor = e.actor?.name ?? "";
  const d = e.data ?? {};
  switch (e.type) {
    case "kick":
      return d.permanent ? t("hpanel.ev.ban", { name, actor }) : t("hpanel.ev.kick", { name, actor });
    case "role":
      return d.role ? t("hpanel.ev.role_set", { name, role: t(`hpanel.role.${String(d.role)}`) }) : t("hpanel.ev.role_removed", { name });
    case "privacy":
      return t("hpanel.ev.privacy", { value: t(`hpanel.privacy.${String(d.privacy ?? "public")}`) });
    case "denied":
      return t("hpanel.ev.denied", { name, why: t(`hpanel.deny.${String(d.code ?? "not_invited")}`) });
    default:
      return t(`hpanel.ev.${e.type}`, { name, actor });
  }
}

export function EventLog({ sessionId }: { sessionId: string }) {
  const t = useT();
  const q = useHostEvents(sessionId);
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-text">
        <Radio size={14} className="text-ok" />
        {t("hpanel.events.title")}
      </h3>
      {q.isPending ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <p className="rounded-card bg-surface px-3 py-3 text-[13px] text-muted">{t("hpanel.events.empty")}</p>
      ) : (
        <ol className="scroll flex max-h-[60vh] flex-col rounded-card bg-surface py-1">
          {q.data.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 px-3 py-1.5 text-[12.5px]">
              <span className={cn("mt-0.5 shrink-0 text-dim", TONE[e.type])}>{ICON[e.type]}</span>
              <span className="min-w-0 flex-1 leading-snug text-text">{text(e, t)}</span>
              <span className="shrink-0 text-caption tabular-nums text-dim">{formatRelative(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
