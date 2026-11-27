import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import type { Notification } from "@/lib/vibe-sdk";
import { onGatewayEvent, useSocial } from "@/features/social/service";
import { applyTicketEvent, loadLocal, openTicket, refreshTickets, setLive, setTicketHooks, useTickets, type TicketEvent } from "./store";
import { reloadTicket } from "./useTicketDetail";

const POLL_MS = 5 * 60_000;
const POLL_LIVE_MS = 15 * 60_000;

function onNotification(n: Notification) {
  if (!n.type.startsWith("ticket.")) return;
  const ticket = typeof n.data?.ticket === "string" ? n.data.ticket : null;
  toast.info(n.title, n.body ?? undefined, ticket ? { label: t("tk.open"), onClick: () => openTicket(ticket) } : undefined, 8000);
  if (ticket) reloadTicket(ticket);
  void refreshTickets(true);
}

export function TicketsHost() {
  const nav = useNavigate();
  const vibe = useVibe();
  const live = useSocial((s) => s.conn === "ready");

  useEffect(() => {
    setTicketHooks(
      (ticket) => void nav({ to: "/tickets", search: ticket ? { t: ticket } : {} }),
      (changed) => {
        if (changed.length === 1) toast.info(t("tk.toast.reply", { ticket: changed[0].ticket }), undefined, { label: t("tk.open"), onClick: () => openTicket(changed[0].ticket) }, 8000);
        else if (changed.length > 1) toast.info(t("tk.toast.many", { n: changed.length }), undefined, { label: t("tk.open"), onClick: () => openTicket() }, 8000);
      },
    );
    void loadLocal();
  }, [nav]);

  useEffect(() => setLive(live), [live]);

  useEffect(() => {
    if (!vibe.enabled) return;
    void refreshTickets(true);
    const id = setInterval(() => void refreshTickets(true), live ? POLL_LIVE_MS : POLL_MS);
    return () => clearInterval(id);
  }, [vibe.enabled, live]);

  useEffect(() => {
    const offs = [
      onGatewayEvent("ticket.updated", (d) => {
        const ev = d as TicketEvent;
        applyTicketEvent(ev);
        if (useTickets.getState().items[ev.id]) reloadTicket(ev.ticket);
      }),
      onGatewayEvent("notification.created", (d) => onNotification(d as Notification)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return null;
}
