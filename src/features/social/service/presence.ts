import { useGameStore, useServerStore } from "@/lib/queries";
import type { Instance, Server } from "@/lib/types";
import type { Activity, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { rt } from "./runtime";

// ------------------------------------------------------------------ Presence (automatisch)

let instancesRef: Instance[] = [];
let serversRef: Server[] = [];

export function setPresenceSources(instances: Instance[], servers: Server[]) {
  instancesRef = instances;
  serversRef = servers;
  pushPresence();
}

export function currentPresence(): { status: PresenceStatusSetting; activity: Activity | null } {
  if (!rt.cfg.presence) return { status: "invisible", activity: null };
  const states = useGameStore.getState().states;
  const running = instancesRef.filter((i) => states[i.id]?.state === "running" || states[i.id]?.state === "preparing");
  if (running.length) {
    const i = running[0];
    const st = states[i.id];
    return {
      status: "online",
      activity: {
        type: "playing",
        instanceId: i.id,
        instanceName: i.name.slice(0, 100),
        mcVersion: i.mc_version,
        loader: i.loader.kind,
        joinable: false,
        startedAt: st?.started_at ? new Date(st.started_at).toISOString() : null,
      },
    };
  }
  const statuses = useServerStore.getState().statuses;
  const hosted = serversRef.find((s) => statuses[s.id]?.state === "running" && statuses[s.id]?.tunnel?.kind === "relay" && statuses[s.id]?.tunnel?.address);
  if (hosted && rt.cfg.hosting) {
    const st = statuses[hosted.id];
    return {
      status: "online",
      activity: {
        type: "hosting",
        instanceName: hosted.name.slice(0, 100),
        world: hosted.name.slice(0, 100),
        mcVersion: hosted.mc_version,
        loader: hosted.loader.kind,
        joinable: false,
        startedAt: st?.started_at ? new Date(st.started_at).toISOString() : null,
      },
    };
  }
  return { status: "online", activity: { type: "launcher", joinable: false } };
}

/** Status ans Gateway schicken, wenn er sich geändert hat. */
export function pushPresence(force = false) {
  const gw = rt.gateway;
  if (!gw) return;
  const p = currentPresence();
  const key = JSON.stringify({ s: p.status, a: p.activity && { ...p.activity, startedAt: undefined } });
  if (!force && key === rt.lastPresence) return;
  rt.lastPresence = key;
  gw.setPresence(p);
}

useGameStore.subscribe((s, prev) => {
  if (s.states !== prev.states) pushPresence();
});
useServerStore.subscribe((s, prev) => {
  if (s.statuses !== prev.statuses) pushPresence();
});
