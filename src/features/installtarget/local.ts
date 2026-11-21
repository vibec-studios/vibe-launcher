import { invoke } from "@tauri-apps/api/core";
import { api } from "@/lib/api";
import type { Server, ServerStatus } from "@/lib/types";
import { addonApi } from "@/features/servers/addonsApi";
import { registerServerTargetProvider, serverTargetKey } from "./registry";
import type { AddonCheck, ServerTargetInfo, ServerTargetProvider } from "./types";

export function localTargetInfo(s: Server, st?: ServerStatus | null): ServerTargetInfo {
  return {
    key: serverTargetKey({ origin: "local", id: s.id }),
    origin: "local",
    id: s.id,
    agentId: null,
    agentName: null,
    name: s.name,
    icon: s.icon,
    accent: s.accent,
    mc_version: s.mc_version,
    loader: s.loader,
    platform: s.platform ?? null,
    running: !!st && st.state !== "stopped" && st.state !== "crashed",
    online: true,
  };
}

export const localServerProvider: ServerTargetProvider = {
  origin: "local",
  async list() {
    const [servers, statuses] = await Promise.all([api.serversList(), api.serverStatuses().catch(() => [] as ServerStatus[])]);
    return servers.filter((s) => !s.remote).map((s) => localTargetInfo(s, statuses.find((x) => x.server_id === s.id)));
  },
  addons: (t) => addonApi.list(t.id),
  search: (t, source, query, sort, offset) => addonApi.search(t.id, source, query, sort, offset),
  install: (t, source, project) => addonApi.install(t.id, source, project),
  check: (t, source, project) => invoke<AddonCheck>("server_addon_check", { id: t.id, source, project }),
  updates: (t) => addonApi.updates(t.id),
  update: (t, files) => addonApi.update(t.id, files),
  hangarProject: (_t, project) => addonApi.project(project),
};

registerServerTargetProvider(localServerProvider);
