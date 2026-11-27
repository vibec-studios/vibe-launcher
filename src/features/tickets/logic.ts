import type { TicketList, TicketMessage, TicketRequest, TicketSummary } from "@/lib/types";

export type LogKind = "launcher" | "game" | "crash";

export function needsAttention(i: Pick<TicketSummary, "unread" | "openRequests" | "canReply">) {
  return i.unread || (i.openRequests > 0 && i.canReply);
}

export function attentionCount(items: Record<string, TicketSummary>) {
  return Object.values(items).filter(needsAttention).length;
}

export function sortedTickets(items: Record<string, TicketSummary>) {
  return Object.values(items).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
}

export function mergeList(prev: Record<string, TicketSummary>, list: TicketList) {
  const items: Record<string, TicketSummary> = list.complete ? {} : { ...prev };
  for (const i of list.items) items[i.id] = { ...prev[i.id], ...i };
  const fresh = list.items.filter((i) => i.unread && prev[i.id] && !prev[i.id].unread);
  return { items, fresh };
}

export function mergeMessages(a: TicketMessage[], b: TicketMessage[]) {
  const map = new Map<number, TicketMessage>();
  for (const m of [...a, ...b]) map.set(m.id, m);
  return [...map.values()].sort((x, y) => x.id - y.id);
}

export function presetLogs(r: Pick<TicketRequest, "type">): LogKind[] {
  if (r.type === "crash_report") return ["crash"];
  if (r.type === "log") return ["launcher", "game"];
  return [];
}

export function isOpenTicket(i: Pick<TicketSummary, "status">) {
  return i.status !== "done" && i.status !== "rejected";
}
