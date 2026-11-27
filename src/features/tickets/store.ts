import { create } from "zustand";
import { api } from "@/lib/api";
import type { LocalTicket, TicketDetail, TicketStatus, TicketSummary } from "@/lib/types";
import { ticketCall, ticketErrorText } from "./call";
import { mergeList } from "./logic";

export { attentionCount, needsAttention, sortedTickets } from "./logic";

interface TicketsState {
  items: Record<string, TicketSummary>;
  local: LocalTicket[];
  loaded: boolean;
  loading: boolean;
  account: boolean;
  error: string | null;
  live: boolean;
}

export const useTickets = create<TicketsState>(() => ({ items: {}, local: [], loaded: false, loading: false, account: false, error: null, live: false }));

const get = useTickets.getState;
const set = useTickets.setState;

type Opener = (ticket?: string) => void;
type Alert = (changed: TicketSummary[]) => void;
let opener: Opener = () => {};
let alert: Alert = () => {};

export function setTicketHooks(o: Opener, a: Alert) {
  opener = o;
  alert = a;
}

export function openTicket(ticket?: string) {
  opener(ticket);
}

export async function loadLocal() {
  const local = await api.ticketsLocal().catch(() => get().local);
  set({ local });
  return local;
}

let inflight: Promise<void> | null = null;

export function refreshTickets(background = false): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    set({ loading: true });
    try {
      const local = await loadLocal();
      if (background && !local.length && !(await hasAccount())) return;
      const list = await ticketCall(() => api.ticketsList(background));
      const { items, fresh } = mergeList(get().items, list);
      if (background && !get().live && fresh.length) alert(fresh);
      set({ items, account: list.account, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: background && get().loaded ? get().error : ticketErrorText(e) });
    } finally {
      set({ loading: false });
      inflight = null;
    }
  })();
  return inflight;
}

async function hasAccount() {
  try {
    const { vibeClient } = await import("@/features/social/service");
    return !!(await vibeClient()?.isLoggedIn());
  } catch {
    return false;
  }
}

export interface TicketEvent {
  id: string;
  ticket: string;
  status: TicketStatus;
  lastActivityAt: string;
  unread: boolean;
  openRequests: number;
}

export function applyTicketEvent(ev: TicketEvent) {
  const cur = get().items[ev.id];
  if (!cur) return void refreshTickets(true);
  set({ items: { ...get().items, [ev.id]: { ...cur, ...ev, canReply: ev.status !== "rejected" } } });
}

export function applyDetail(d: TicketDetail) {
  const cur = get().items[d.id];
  const next: TicketSummary = {
    ...(cur ?? { excerpt: d.message.slice(0, 160) }),
    id: d.id,
    ticket: d.ticket,
    kind: d.kind,
    status: d.status,
    app: d.app,
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    lastActivityAt: d.lastActivityAt,
    unread: d.unread,
    openRequests: d.openRequests,
    canReply: d.canReply,
    local: d.local ?? cur?.local,
  };
  set({ items: { ...get().items, [d.id]: next } });
}

export function markSeen(id: string) {
  const cur = get().items[id];
  if (cur?.unread) set({ items: { ...get().items, [id]: { ...cur, unread: false } } });
}

export function setLive(live: boolean) {
  if (get().live !== live) set({ live });
}
