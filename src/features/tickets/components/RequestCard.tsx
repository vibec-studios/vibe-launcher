import { CheckCircle2, FileText, Image as ImageIcon, ListTodo, MessageSquareText, Siren, Undo2 } from "lucide-react";
import type { TicketRequest, TicketRequestType } from "@/lib/types";
import { Button, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function RequestIcon({ type, size = 14 }: { type: TicketRequestType; size?: number }) {
  const Icon = type === "screenshot" ? ImageIcon : type === "crash_report" ? Siren : type === "text" ? MessageSquareText : FileText;
  return <Icon size={size} />;
}

export function RequestCard({ r, onFulfill, compact }: { r: TicketRequest; onFulfill?: (r: TicketRequest) => void; compact?: boolean }) {
  const t = useT();
  const open = r.status === "open";
  return (
    <div
      data-testid="ticket-request"
      className={cn(
        "flex items-start gap-3 rounded-card px-3.5 py-2.5",
        open ? "bg-warn/10 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-warn)_30%,transparent)]" : "bg-surface/60",
      )}
    >
      <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-ctl", open ? "bg-warn/15 text-warn" : "bg-white/[.06] text-dim")}>
        <RequestIcon type={r.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-text">
          {t(`tk.req.title.${r.type}`)}
          {r.status === "fulfilled" && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ok">
              <CheckCircle2 size={12} />
              {t("tk.req.fulfilled")}
            </span>
          )}
          {r.status === "cancelled" && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-dim">
              <Undo2 size={12} />
              {t("tk.req.cancelled")}
            </span>
          )}
        </div>
        {r.message && <p className={cn("selectable mt-0.5 break-words text-[12.5px] text-muted", compact ? "line-clamp-2" : "whitespace-pre-wrap")}>{r.message}</p>}
        {open && !compact && <p className="mt-0.5 text-[12px] text-dim">{t(`tk.req.hint.${r.type}`)}</p>}
      </div>
      {open && onFulfill && (
        <Button size="sm" variant="primary" icon={<ListTodo size={13} />} onClick={() => onFulfill(r)} data-testid="ticket-fulfill">
          {t(`tk.req.action.${r.type}`)}
        </Button>
      )}
    </div>
  );
}
