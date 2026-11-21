import { useEffect } from "react";
import type { HostKickEvent, HostPanelUpdatedEvent, HostSessionEvent } from "@/lib/vibe-sdk";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { onGatewayEvent, useSocial } from "@/features/social/service";
import { applyHostEvent, applyPanelUpdate, closeHostPanel, useHostPanelStore } from "./api";
import { HostPanelDialog } from "./HostPanelDialog";

export function HostPanelHost() {
  useEffect(() => {
    const offs = [
      onGatewayEvent("hosting.panel.updated", (d) => applyPanelUpdate(d as HostPanelUpdatedEvent)),
      onGatewayEvent("hosting.event", (d) => applyHostEvent(d as HostSessionEvent)),
      onGatewayEvent("hosting.kick", (d) => {
        const ev = d as HostKickEvent;
        const me = useSocial.getState().me;
        if (!me || ev.hostId === me.id) return;
        const host = useSocial.getState().friends[ev.hostId]?.user.name ?? "";
        toast.info(ev.permanent ? t("hpanel.kicked.ban", { host }) : t("hpanel.kicked.round", { host }), ev.reason ?? undefined);
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  const open = useHostPanelStore((s) => s.open);
  if (!open) return null;
  return <HostPanelDialog sessionId={open} onClose={closeHostPanel} />;
}
