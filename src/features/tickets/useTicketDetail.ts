import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { TicketDetail, TicketPosted } from "@/lib/types";
import { ticketCall } from "./call";
import { mergeMessages } from "./logic";
import { applyDetail, markSeen } from "./store";

export const POLL_OPEN_MS = 45_000;

export const ticketKey = (ticket: string) => ["ticket", ticket.toUpperCase()] as const;

async function load(ticket: string): Promise<TicketDetail> {
  const prev = queryClient.getQueryData<TicketDetail>(ticketKey(ticket));
  const after = prev?.messages.at(-1)?.id ?? null;
  const d = await ticketCall(() => api.ticketGet(ticket, after));
  const merged = prev && after !== null ? { ...d, messages: mergeMessages(prev.messages, d.messages) } : d;
  applyDetail(merged);
  return merged;
}

export function useTicketDetail(ticket: string | null) {
  const q = useQuery({
    queryKey: ticketKey(ticket ?? ""),
    queryFn: () => load(ticket!),
    enabled: !!ticket,
    refetchInterval: POLL_OPEN_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const d = q.data;
  useEffect(() => {
    if (!d?.unread) return;
    void ticketCall(() => api.ticketRead(d.ticket))
      .then(() => {
        markSeen(d.id);
        queryClient.setQueryData<TicketDetail>(ticketKey(d.ticket), (old) => (old ? { ...old, unread: false } : old));
      })
      .catch(() => {});
  }, [d?.unread, d?.ticket, d?.id, d?.lastActivityAt]);
  return q;
}

export function afterPost(ticket: string, r: TicketPosted) {
  queryClient.setQueryData<TicketDetail>(ticketKey(ticket), (old) => {
    if (!old) return old;
    const requests = old.requests.map((x) => (r.fulfilled.includes(x.id) ? { ...x, status: "fulfilled" as const, fulfilledByMessageId: r.message.id } : x));
    return { ...old, status: r.status, messages: mergeMessages(old.messages, [r.message]), requests, openRequests: requests.filter((x) => x.status === "open").length };
  });
  void queryClient.invalidateQueries({ queryKey: ticketKey(ticket) });
}

export function reloadTicket(ticket: string) {
  void queryClient.invalidateQueries({ queryKey: ticketKey(ticket) });
}
