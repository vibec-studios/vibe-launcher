// Spieler eines Servers: eine Werkzeugleiste (Online | Whitelist | OPs | Gebannt | IP-Banns + Suche, rechts der
// Whitelist-Schalter) über einer flachen Liste. Zeilenaktionen im ⋯-Menü bzw. per Rechtsklick.
import { useDeferredValue, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { ErrorState, SearchInput, Segmented, Switch, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { ListView } from "./players/ListView";
import { OnlineView } from "./players/OnlineView";
import type { Sub } from "./players/playerActions";

export function PlayersTab({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const q = useQuery({ queryKey: sqk.players(server.id), queryFn: () => api.serverPlayers(server.id), staleTime: 15_000 });
  const [wlBusy, setWlBusy] = useState(false);
  const [sub, setSub] = useState<Sub>("online");
  const [query, setQuery] = useState("");
  const dq = useDeferredValue(query.trim().toLowerCase());

  // Join/Leave ändert u. U. Listen (z. B. Whitelist per Befehl) -> leise nachladen
  const playersKey = st?.players.join(",") ?? "";
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: sqk.players(server.id) });
  }, [playersKey, st?.state, server.id]);

  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="h-full" />;
  const d = q.data;
  const running = st?.state === "running";
  const online = running ? (st?.players ?? d?.online ?? []) : [];

  const setWhitelist = async (enabled: boolean) => {
    setWlBusy(true);
    try {
      queryClient.setQueryData(sqk.players(server.id), await api.serverSetWhitelist(server.id, enabled));
      queryClient.invalidateQueries({ queryKey: sqk.properties(server.id) });
    } catch (e) {
      toast.error(e);
    } finally {
      setWlBusy(false);
    }
  };

  const seg = (label: string, n: number | undefined) => (
    <span className="flex items-center gap-1.5">
      {label}
      {n !== undefined && <span className="text-[12px] font-medium text-dim">{n}</span>}
    </span>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-6">
        <Segmented<Sub>
          value={sub}
          onChange={setSub}
          items={[
            { value: "online", label: seg(t("srv.players.online"), running ? online.length : undefined) },
            { value: "whitelist", label: seg(t("srv.players.whitelist"), d?.whitelist.length) },
            { value: "ops", label: seg(t("srv.players.seg.ops"), d?.ops.length) },
            { value: "banned", label: seg(t("srv.players.seg.banned"), d?.banned.length) },
            { value: "banned_ips", label: seg(t("srv.players.seg.banned_ips"), d?.banned_ips.length) },
          ]}
        />
        <SearchInput value={query} onChange={setQuery} placeholder={t("srv.players.search")} className="w-[200px] min-w-[140px] [&_input]:h-8" />
        <div className="flex-1" />
        {sub === "online" && running && (
          <span className="text-meta tabular-nums text-dim">{t("srv.players_n", { n: online.length, max: st?.max_players ?? "–" })}</span>
        )}
        {sub === "whitelist" && (
          <label className="flex items-center gap-2 text-meta text-muted">
            {d?.whitelist_enabled ? t("srv.players.whitelist.on") : t("srv.players.whitelist.off")}
            <Switch checked={!!d?.whitelist_enabled} disabled={!d || wlBusy} onChange={setWhitelist} label={t("srv.players.whitelist")} />
          </label>
        )}
      </div>
      <div className="scroll min-h-0 flex-1">
        <div className="w-full px-6 pb-8 pt-1">
          {sub === "online" ? (
            <OnlineView server={server} data={d} online={online} q={dq} />
          ) : sub === "whitelist" ? (
            <ListView
              server={server}
              list="whitelist"
              entries={d?.whitelist}
              q={dq}
              placeholder={t("srv.players.name")}
              empty={t("srv.players.whitelist.empty")}
            />
          ) : sub === "ops" ? (
            <ListView
              server={server}
              list="ops"
              entries={d?.ops}
              q={dq}
              placeholder={t("srv.players.name")}
              empty={t("srv.players.ops.empty")}
              extra={(e) => e.level !== null && <span className="font-mono text-[11px] text-dim">{t("srv.players.level", { n: e.level })}</span>}
            />
          ) : sub === "banned" ? (
            <ListView
              server={server}
              list="banned"
              entries={d?.banned}
              q={dq}
              placeholder={t("srv.players.name")}
              empty={t("srv.players.banned.empty")}
              withReason
            />
          ) : (
            <ListView
              server={server}
              list="banned_ips"
              entries={d?.banned_ips}
              q={dq}
              placeholder="192.168.0.10"
              empty={t("srv.players.banned_ips.empty")}
              withReason
              mono
            />
          )}
        </div>
      </div>
    </div>
  );
}
