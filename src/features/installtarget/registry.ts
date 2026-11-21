import { create } from "zustand";
import type { ServerInstallTarget, ServerOrigin, ServerTargetInfo, ServerTargetProvider } from "./types";

interface Registry {
  providers: Partial<Record<ServerOrigin, ServerTargetProvider>>;
}

export const useTargetRegistry = create<Registry>(() => ({ providers: {} }));

export function registerServerTargetProvider(p: ServerTargetProvider) {
  useTargetRegistry.setState((s) => ({ providers: { ...s.providers, [p.origin]: p } }));
  return () =>
    useTargetRegistry.setState((s) => {
      const next = { ...s.providers };
      if (next[p.origin] === p) delete next[p.origin];
      return { providers: next };
    });
}

export function providerFor(origin: ServerOrigin): ServerTargetProvider | null {
  return useTargetRegistry.getState().providers[origin] ?? null;
}

export function serverTargetKey(t: Pick<ServerInstallTarget, "origin" | "id" | "agentId">): string {
  return t.origin === "remote" ? `remote:${t.agentId ?? ""}:${t.id}` : `local:${t.id}`;
}

const REMOTE_ID = /^rem~([^~]+)~(.+)$/;

export function serverKeyOf(serverId: string): string {
  const m = REMOTE_ID.exec(serverId);
  return m ? serverTargetKey({ origin: "remote", agentId: m[1], id: m[2] }) : serverTargetKey({ origin: "local", id: serverId });
}

export function parseServerTargetKey(key: string | undefined | null): ServerInstallTarget | null {
  if (!key) return null;
  if (key.startsWith("local:")) {
    const id = key.slice(6);
    if (REMOTE_ID.test(id)) return parseServerTargetKey(serverKeyOf(id));
    return id ? { kind: "server", origin: "local", id } : null;
  }
  if (REMOTE_ID.test(key)) return parseServerTargetKey(serverKeyOf(key));
  if (key.startsWith("remote:")) {
    const rest = key.slice(7);
    const i = rest.indexOf(":");
    if (i <= 0 || i === rest.length - 1) return null;
    return { kind: "server", origin: "remote", agentId: rest.slice(0, i), id: rest.slice(i + 1) };
  }
  return { kind: "server", origin: "local", id: key };
}

export function addonSupport(t: Pick<ServerTargetInfo, "platform" | "loader">): "plugins" | "mods" | null {
  if (t.platform) return "plugins";
  return t.loader.kind === "vanilla" ? null : "mods";
}
