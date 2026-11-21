import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { sqk, useServers, useServerStore } from "@/lib/queries";
import type { Server } from "@/lib/types";

export type Hosted = { server: Server; address: string; kind: "relay" | "playit" | "direct" };

/** Eigene laufende Server: über Relay/playit erreichbar oder lokal (LAN-Adresse, nur im selben Netzwerk). */
export function useHostedServers(): Hosted[] {
  const { data: servers = [] } = useServers();
  const statuses = useServerStore((s) => s.statuses);
  const running = servers.filter((s) => statuses[s.id]?.state === "running");
  const local = running.filter((s) => s.connection === "local");
  const addrs = useQueries({
    queries: local.map((s) => ({ queryKey: sqk.addresses(s.id), queryFn: () => api.serverAddresses(s.id), staleTime: 60_000 })),
  });
  const lan = local.map((s, i) => ({ s, a: addrs[i]?.data?.lan[0] ?? null }));
  const lanKey = lan.map((x) => `${x.s.id}=${x.a}`).join(",");
  return useMemo(() => {
    const out: Hosted[] = [];
    for (const server of servers) {
      const st = statuses[server.id];
      if (st?.state !== "running") continue;
      const tun = st.tunnel;
      if (tun?.address && (tun.kind === "relay" || tun.kind === "playit") && tun.state !== "error") out.push({ server, address: tun.address, kind: tun.kind });
      else if (server.connection === "local") {
        const a = lan.find((x) => x.s.id === server.id)?.a;
        if (a) out.push({ server, address: a, kind: "direct" });
      }
    }
    return out;
  }, [servers, statuses, lanKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
