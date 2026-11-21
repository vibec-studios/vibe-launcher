import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { queryClient } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import { VibeError, type HostPanel, type HostPanelUpdatedEvent, type HostSessionEvent } from "@/lib/vibe-sdk";
import { t } from "@/i18n";
import { errText, requireClient, useSocial, vibeClient, vqk } from "@/features/social/service";

export const hpk = {
  panel: (id: string) => ["vibe", "hosting", "panel", id] as const,
  events: (id: string) => ["vibe", "hosting", "events", id] as const,
};

export const useHostPanelStore = create<{ open: string | null }>(() => ({ open: null }));
export const openHostPanel = (id: string) => useHostPanelStore.setState({ open: id });
export const closeHostPanel = () => useHostPanelStore.setState({ open: null });

export function useMyHosts() {
  const vibe = useVibe();
  const ready = useSocial((s) => s.conn === "ready");
  return useQuery({
    queryKey: vqk.hostingMine,
    queryFn: () => requireClient().hosting.mine(),
    enabled: vibe.hosting && ready && !!vibeClient(),
    staleTime: 20_000,
    select: (l) => l.filter((h) => h.status !== "ended"),
  });
}

export function useHostPanel(id: string) {
  return useQuery({ queryKey: hpk.panel(id), queryFn: () => requireClient().hosting.panel(id), retry: 0, staleTime: 10_000, refetchInterval: 30_000 });
}

export function useHostEvents(id: string) {
  return useQuery({ queryKey: hpk.events(id), queryFn: async () => (await requireClient().hosting.events(id, { limit: 50 })).events, retry: 0, staleTime: 15_000 });
}

export async function panelAction(id: string, fn: () => Promise<HostPanel>) {
  const p = await fn();
  queryClient.setQueryData(hpk.panel(id), p);
  return p;
}

export function applyPanelUpdate(ev: HostPanelUpdatedEvent) {
  queryClient.setQueryData<HostPanel>(hpk.panel(ev.sessionId), (p) => (p ? { ...p, policy: ev.policy, members: ev.members, kicks: ev.kicks } : p));
}

export function applyHostEvent(ev: HostSessionEvent) {
  queryClient.setQueryData<HostSessionEvent[]>(hpk.events(ev.sessionId), (l) => (l ? [ev, ...l.filter((x) => x.id !== ev.id)].slice(0, 200) : l));
  if (ev.type === "join" || ev.type === "leave" || ev.type === "kick" || ev.type === "role") void queryClient.invalidateQueries({ queryKey: hpk.panel(ev.sessionId) });
}

export function hostError(e: unknown): string {
  if (e instanceof VibeError) {
    if (e.status === 410) return t("hpanel.err.gone");
    if (e.code === "forbidden") return t("hpanel.err.forbidden");
    if (e.code === "limit_reached") return t("hpanel.err.limit");
    if (e.status === 404) return t("hpanel.err.not_found");
  }
  return errText(e);
}
