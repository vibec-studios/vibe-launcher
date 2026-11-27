import type { ReactNode } from "react";
import { Flag, Undo2 } from "lucide-react";
import type { TicketDetail, TicketMessage, TicketRequest } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { MINE_BG } from "@/features/social/chat/utils";
import { Attachments } from "./Attachments";
import { RequestCard } from "./RequestCard";

function stamp(iso: string) {
  const lang = document.documentElement.lang || "de";
  return new Date(iso).toLocaleString(lang, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Bubble({ mine, name, at, children }: { mine: boolean; name: string; at: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div className={cn("flex items-baseline gap-2 px-0.5", mine && "flex-row-reverse")}>
        <span className={cn("text-[12.5px] font-semibold", mine ? "text-muted" : "text-brand")}>{name}</span>
        <span className="text-[11px] tabular-nums text-dim">{stamp(at)}</span>
      </div>
      <div className={cn("flex max-w-[min(640px,82%)] flex-col gap-2 rounded-card px-3.5 py-2.5", mine ? MINE_BG : "bg-surface2")}>{children}</div>
    </div>
  );
}

function Line({ icon, children, at }: { icon?: ReactNode; children: ReactNode; at: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5 text-[11.5px] text-dim">
      {icon}
      <span>{children}</span>
      <span className="tabular-nums">· {stamp(at)}</span>
    </div>
  );
}

function Body({ text }: { text: string }) {
  if (!text) return null;
  return <p className="selectable whitespace-pre-wrap break-words text-[13.5px] leading-[1.45] text-text">{text}</p>;
}

function Entry({ m, d }: { m: TicketMessage; d: TicketDetail }) {
  const t = useT();
  if (m.kind === "status") {
    const to = m.data?.to;
    return <Line at={m.createdAt}>{to ? t("tk.line.status", { status: t(`tk.status.${to}`) }) : m.body}</Line>;
  }
  if (m.kind === "request_cancelled") {
    return (
      <Line icon={<Undo2 size={12} />} at={m.createdAt}>
        {t("tk.line.cancelled")}
      </Line>
    );
  }
  if (m.kind === "request") {
    const r = d.requests.find((x) => x.id === m.requestId);
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-baseline gap-2 px-0.5">
          <span className="text-[12.5px] font-semibold text-brand">{t("tk.team")}</span>
          <span className="text-[11px] tabular-nums text-dim">{stamp(m.createdAt)}</span>
        </div>
        <div className="w-full max-w-[min(640px,82%)]">
          {r ? (
            <RequestCard r={{ ...r, message: m.body || r.message }} />
          ) : (
            <Body text={m.body} />
          )}
        </div>
      </div>
    );
  }
  const mine = m.author.type === "user";
  if (m.author.type === "system") return <Line at={m.createdAt}>{m.body}</Line>;
  const fulfilled = m.fulfills.map((id) => d.requests.find((r) => r.id === id)).filter((r): r is TicketRequest => !!r);
  return (
    <Bubble mine={mine} name={mine ? t("tk.you") : t("tk.team")} at={m.createdAt}>
      <Body text={m.body} />
      <Attachments items={m.attachments} ticket={d.ticket} />
      {fulfilled.length > 0 && <span className="text-[11.5px] text-ok">{t("tk.fulfills", { what: fulfilled.map((r) => t(`tk.req.title.${r.type}`)).join(", ") })}</span>}
    </Bubble>
  );
}

function ReportInfo({ d }: { d: TicketDetail }) {
  const t = useT();
  if (!d.report) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-card bg-surface/60 px-3.5 py-2.5 text-[12.5px]">
      <Flag size={14} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 text-muted">
        <span className="font-semibold text-text">{t(`tk.reason.${d.report.reason}`)}</span>
        {d.report.chatName && <span> · {d.report.chatName}</span>}
        <span> · {t("tk.report.messages", { n: d.report.messages })}</span>
        <span className="block text-dim">{t(`tk.report.status.${d.report.status}`)}</span>
      </div>
    </div>
  );
}

export function Timeline({ d }: { d: TicketDetail }) {
  const t = useT();
  const first = d.attachments.filter((a) => a.messageId === null);
  return (
    <div className="flex flex-col gap-3">
      <ReportInfo d={d} />
      <Bubble mine name={t("tk.you")} at={d.createdAt}>
        <Body text={d.message} />
        <Attachments items={first} ticket={d.ticket} />
        {d.contact && <span className="text-[11.5px] text-dim">{t("tk.contact", { contact: d.contact })}</span>}
      </Bubble>
      {d.messages.map((m) => (
        <Entry key={m.id} m={m} d={d} />
      ))}
    </div>
  );
}
