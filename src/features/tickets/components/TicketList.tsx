import { memo } from "react";
import { ListTodo } from "lucide-react";
import type { TicketSummary } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { isOpenTicket, needsAttention } from "../logic";
import { KindIcon, StatusBadge } from "./StatusBadge";

export type ListFilter = "open" | "all";

const Row = memo(function Row({ i, active, onSelect }: { i: TicketSummary; active: boolean; onSelect: (ticket: string) => void }) {
  const t = useT();
  const attention = needsAttention(i);
  return (
    <button
      onClick={() => onSelect(i.ticket)}
      data-testid="ticket-row"
      aria-current={active || undefined}
      className={cn("flex w-full flex-col gap-1 rounded-card px-3 py-2.5 text-left transition-colors duration-100", active ? "bg-white/[.07]" : "hover:bg-white/[.04]")}
    >
      <div className="flex items-center gap-2">
        <KindIcon kind={i.kind} size={13} className="shrink-0 text-dim" />
        <span className={cn("font-mono text-[12.5px]", i.unread ? "font-bold text-text" : "font-semibold text-muted")}>{i.ticket}</span>
        <StatusBadge status={i.status} />
        <span className="flex-1" />
        <span className="shrink-0 text-[11px] tabular-nums text-dim">{formatRelative(i.lastActivityAt)}</span>
        {attention && <span className="h-2 w-2 shrink-0 rounded-dot bg-brand" aria-label={t("tk.unread")} />}
      </div>
      <p className={cn("line-clamp-2 text-[12.5px] leading-snug", i.unread ? "text-text" : "text-muted")}>{i.excerpt || t(`tk.kind.${i.kind}`)}</p>
      {i.openRequests > 0 && i.canReply && (
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-warn">
          <ListTodo size={12} />
          {t("tk.list.requests", { n: i.openRequests })}
        </span>
      )}
    </button>
  );
});

export function TicketList({
  items,
  active,
  onSelect,
  filter,
  setFilter,
  loading,
}: {
  items: TicketSummary[];
  active: string | null;
  onSelect: (ticket: string) => void;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
  loading: boolean;
}) {
  const t = useT();
  const shown = filter === "open" ? items.filter(isOpenTicket) : items;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <Segmented<ListFilter>
          value={filter}
          onChange={setFilter}
          items={[
            { value: "open", label: t("tk.filter.open") },
            { value: "all", label: t("tk.filter.all") },
          ]}
        />
        <span className="flex-1" />
        {loading && <Spinner size={13} />}
      </div>
      <div className="scroll min-h-0 flex-1 px-1.5 pb-3">
        {shown.length ? (
          <div className="flex flex-col gap-0.5">
            {shown.map((i) => (
              <Row key={i.id} i={i} active={active?.toUpperCase() === i.ticket.toUpperCase()} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <p className="px-3 py-8 text-center text-[12.5px] text-dim">{filter === "open" ? t("tk.list.none_open") : t("tk.list.none")}</p>
        )}
      </div>
    </div>
  );
}
