import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Info, LifeBuoy, MessageSquareWarning } from "lucide-react";
import { Button, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import { openFeedback } from "@/features/feedback/store";
import { refreshTickets, sortedTickets, useTickets } from "./store";
import { TicketList, type ListFilter } from "./components/TicketList";
import { TicketView } from "./components/TicketView";

export function TicketsPage() {
  const t = useT();
  const nav = useNavigate();
  const search = useSearch({ from: "/tickets" });
  const items = useTickets((s) => s.items);
  const loaded = useTickets((s) => s.loaded);
  const loading = useTickets((s) => s.loading);
  const error = useTickets((s) => s.error);
  const account = useTickets((s) => s.account);
  const list = useMemo(() => sortedTickets(items), [items]);
  const [filter, setFilter] = useState<ListFilter>("all");
  const selected = search.t ?? list[0]?.ticket ?? null;

  useEffect(() => {
    void refreshTickets(false);
  }, []);

  const select = (ticket: string) => void nav({ to: "/tickets", search: { t: ticket }, replace: true });
  const newFeedback = (
    <Button variant="primary" icon={<MessageSquareWarning size={15} />} onClick={() => void openFeedback({ source: "button" })}>
      {t("tk.new")}
    </Button>
  );

  if (!loaded) return <Spinner size={20} className="m-auto mt-24 block text-muted" />;
  if (!list.length && !search.t) {
    if (error) return <ErrorState error={error} onRetry={() => void refreshTickets(false)} className="mx-auto mt-24 max-w-md" />;
    return <EmptyState icon={<LifeBuoy size={28} />} title={t("tk.empty")} text={t("tk.empty_text")} action={newFeedback} className="mt-16" />;
  }

  return (
    <div className="flex h-full min-h-0 gap-0 px-6 pb-4 pt-4" data-testid="tickets-page">
      <aside className="flex w-[320px] shrink-0 flex-col rounded-l-card bg-surface/40 pt-3">
        <TicketList items={list} active={selected} onSelect={select} filter={filter} setFilter={setFilter} loading={loading} />
        <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {!account && (
            <p className="flex items-start gap-1.5 text-[11.5px] text-dim">
              <Info size={12} className="mt-px shrink-0" />
              {t("tk.local_only")}
            </p>
          )}
          {newFeedback}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col rounded-r-card bg-surface/20">
        {selected ? <TicketView key={selected.toUpperCase()} ticket={selected} /> : null}
      </section>
    </div>
  );
}
