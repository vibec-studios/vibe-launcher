// Spieler eines Servers: eine Werkzeugleiste (Online | Whitelist | OPs | Gebannt | IP-Banns + Suche, rechts der
// Whitelist-Schalter) über einer flachen Liste. Zeilenaktionen im ⋯-Menü bzw. per Rechtsklick.
import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Crown, ListChecks, LogOut, MoreHorizontal, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus } from "@/lib/queries";
import type { Server, ServerPlayerEntry, ServerPlayerList, ServerPlayers } from "@/lib/types";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  ErrorState,
  IconButton,
  Input,
  SearchInput,
  Segmented,
  Skeleton,
  Switch,
  cn,
  toast,
  type MenuItemProps,
} from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useT, t as tt } from "@/i18n";

type Sub = "online" | ServerPlayerList;

async function act(server: Server, list: ServerPlayerList, action: "add" | "remove", name: string, reason?: string | null): Promise<boolean> {
  try {
    const next = await api.serverPlayerAction(server.id, list, action, name, reason ?? null);
    queryClient.setQueryData(sqk.players(server.id), next);
    return true;
  } catch (e) {
    toast.error(e, tt("srv.players.failed", { name }));
    return false;
  }
}

const rowCls = "group flex h-11 items-center gap-3 rounded-ctl px-3 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04]";

function AddRow({ placeholder, onAdd, withReason, mono }: { placeholder: string; onAdd: (name: string, reason: string | null) => Promise<boolean>; withReason?: boolean; mono?: boolean }) {
  const t = useT();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    if (await onAdd(n, reason.trim() || null)) {
      setName("");
      setReason("");
    }
    setBusy(false);
  };
  return (
    <form
      className="mb-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input className={cn("flex-1", mono && "font-mono text-[13px]")} value={name} placeholder={placeholder} maxLength={64} onChange={(e) => setName(e.target.value)} />
      {withReason && <Input className="flex-1" value={reason} placeholder={t("srv.players.reason")} maxLength={120} onChange={(e) => setReason(e.target.value)} />}
      <Button type="submit" icon={<Plus size={14} />} disabled={!name.trim()} loading={busy}>
        {t("srv.players.add")}
      </Button>
    </form>
  );
}

function EntryRow({ entry, right, onRemove, mono }: { entry: ServerPlayerEntry; right?: ReactNode; onRemove: () => void; mono?: boolean }) {
  const t = useT();
  return (
    <ContextMenu
      content={
        <ContextItem icon={<X size={14} />} danger onSelect={onRemove}>
          {t("common.remove")}
        </ContextItem>
      }
    >
      <div className={rowCls}>
        {!mono && <PlayerHead uuid={entry.uuid ?? entry.name} name={entry.name} size={24} />}
        <div className="min-w-0 flex-1">
          <div className={mono ? "selectable truncate font-mono text-[13px] text-text" : "selectable truncate text-[13px] font-medium text-text"}>{entry.name}</div>
          {entry.reason && <div className="truncate text-caption text-dim">{entry.reason}</div>}
        </div>
        {right}
        <IconButton label={t("common.remove")} tip variant="ghost" size="sm" className="opacity-60 group-hover:opacity-100" onClick={onRemove}>
          <X size={14} />
        </IconButton>
      </div>
    </ContextMenu>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-10 text-center text-[13px] text-dim">{children}</div>;
}

function ListView({
  server,
  list,
  entries,
  q,
  placeholder,
  empty,
  withReason,
  mono,
  extra,
}: {
  server: Server;
  list: ServerPlayerList;
  entries: ServerPlayerEntry[] | undefined;
  q: string;
  placeholder: string;
  empty: string;
  withReason?: boolean;
  mono?: boolean;
  extra?: (e: ServerPlayerEntry) => ReactNode;
}) {
  const t = useT();
  const shown = entries?.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.reason ?? "").toLowerCase().includes(q));
  return (
    <>
      <AddRow placeholder={placeholder} withReason={withReason} mono={mono} onAdd={(n, r) => act(server, list, "add", n, r)} />
      {!shown ? (
        <div className="flex flex-col gap-2 py-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : entries!.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : shown.length === 0 ? (
        <Empty>{t("srv.players.no_match")}</Empty>
      ) : (
        <div className="-mx-3 flex flex-col">
          {shown.map((e) => (
            <EntryRow key={e.uuid ?? e.name} entry={e} mono={mono} right={extra?.(e)} onRemove={() => act(server, list, "remove", e.name)} />
          ))}
        </div>
      )}
    </>
  );
}

/** Aktionen für einen Online-Spieler – gleich für ⋯-Menü und Rechtsklick. */
function OnlineActions({ server, name, isOp, canCmd, Item, Sep }: { server: Server; name: string; isOp: boolean; canCmd: boolean; Item: (p: MenuItemProps) => ReactNode; Sep: () => ReactNode }) {
  const t = useT();
  const cmd = (c: string) => api.serverCommand(server.id, c).catch((e) => toast.error(e, t("srv.console.failed")));
  return (
    <>
      <Item icon={<Crown size={14} />} disabled={isOp} onSelect={() => act(server, "ops", "add", name)}>
        {t("srv.players.make_op")}
      </Item>
      <Item icon={<ListChecks size={14} />} onSelect={() => act(server, "whitelist", "add", name)}>
        {t("srv.players.to_whitelist")}
      </Item>
      <Sep />
      <Item icon={<LogOut size={14} />} disabled={!canCmd} onSelect={() => cmd(`kick ${name}`)}>
        {t("srv.players.kick")}
      </Item>
      <Item icon={<Ban size={14} />} danger onSelect={() => act(server, "banned", "add", name)}>
        {t("srv.players.ban")}
      </Item>
    </>
  );
}

function OnlineView({ server, data, online, q }: { server: Server; data: ServerPlayers | undefined; online: string[]; q: string }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const running = st?.state === "running";
  const canCmd = running && !st?.detached;
  const shown = online.filter((n) => !q || n.toLowerCase().includes(q));
  if (!running) return <Empty>{t("srv.players.not_running")}</Empty>;
  if (online.length === 0) return <Empty>{t("srv.players.nobody")}</Empty>;
  if (shown.length === 0) return <Empty>{t("srv.players.no_match")}</Empty>;
  return (
    <div className="-mx-3 flex flex-col">
      {shown.map((name) => {
        const isOp = !!data?.ops.some((o) => o.name.toLowerCase() === name.toLowerCase());
        return (
          <ContextMenu key={name} content={<OnlineActions server={server} name={name} isOp={isOp} canCmd={canCmd} Item={ContextItem} Sep={ContextSeparator} />}>
            <div className={rowCls}>
              <PlayerHead uuid={name} name={name} size={24} />
              <span className="selectable min-w-0 flex-1 truncate text-[13px] font-medium text-text">{name}</span>
              {isOp && <Crown size={13} className="shrink-0 text-warn" aria-label={t("srv.players.ops")} />}
              <DropdownMenu
                trigger={
                  <IconButton label={t("common.more")} tip variant="ghost" size="sm" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal size={15} />
                  </IconButton>
                }
              >
                <OnlineActions server={server} name={name} isOp={isOp} canCmd={canCmd} Item={DropdownItem} Sep={DropdownSeparator} />
              </DropdownMenu>
            </div>
          </ContextMenu>
        );
      })}
    </div>
  );
}

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
