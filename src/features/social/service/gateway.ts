import { VibeGateway } from "@/lib/vibe-sdk";
import { TauriWebSocket } from "@/lib/vibe-sdk/tauri";
import { currentPresence } from "./presence";
import { rt } from "./runtime";
import { set } from "./store";
import { wireGateway } from "./wire";

// ------------------------------------------------------------------ Gateway-Events für andere Features
// (z. B. `pack.version.published`). Überlebt Neuverbindungen und neue Gateways.

type ExtraListener = { ev: string; fn: (d: unknown) => void; off?: () => void };
export const extraListeners = new Set<ExtraListener>();

/** Gateway-Event abonnieren (auch Events, die das SDK noch nicht typisiert). Gibt die Abmeldung zurück. */
export function onGatewayEvent(ev: string, fn: (d: unknown) => void): () => void {
  const l: ExtraListener = { ev, fn };
  extraListeners.add(l);
  if (rt.gateway) l.off = (rt.gateway as unknown as { on: (e: string, f: (d: unknown) => void) => () => void }).on(ev, fn);
  return () => {
    extraListeners.delete(l);
    l.off?.();
  };
}

export function stopGateway() {
  while (rt.offGateway.length) rt.offGateway.pop()!();
  rt.gateway?.disconnect();
  rt.gateway = null;
  rt.lastPresence = "";
}

export function startGateway() {
  if (!rt.client) return;
  if (rt.gateway) {
    rt.gateway.connect();
    return;
  }
  const gw = new VibeGateway(rt.client, { WebSocket: TauriWebSocket as unknown as typeof WebSocket, presence: currentPresence(), maxBackoffMs: 30_000 });
  rt.gateway = gw;
  wireGateway(gw);
  set({ conn: "connecting" });
  gw.connect();
}
