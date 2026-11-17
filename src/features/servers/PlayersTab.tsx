// Spieler eines Servers: Online-Liste (Live-Status), Whitelist, OPs, Banns und IP-Banns.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Crown, ListChecks, LogOut, Plus, ShieldOff, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus } from "@/lib/queries";
import type { Server, ServerPlayerEntry, ServerPlayerList, ServerPlayers } from "@/lib/types";
import { Button, ContextItem, ContextMenu, ContextSeparator, ErrorState, IconButton, Input, SettingsCard, Skeleton, Switch, Tooltip, toast } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useT, t as tt } from "@/i18n";

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
      className="flex gap-2 border-b border-line px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input className={mono ? "flex-1 font-mono text-[13px] h-9!" : "flex-1 h-9!"} value={name} placeholder={placeholder} maxLength={64} onChange={(e) => setName(e.target.value)} />
      {withReason && <Input className="flex-1 h-9!" value={reason} placeholder={t("srv.players.reason")} maxLength={120} onChange={(e) => setReason(e.target.value)} />}
      <Button type="submit" size="sm" className="h-9" icon={<Plus size={13} />} disabled={!name.trim()} loading={busy}>
        {t("srv.players.add")}
      </Button>
    </form>
  );
}

function EntryRow({ entry, right, onRemove, mono }: { entry: ServerPlayerEntry; right?: ReactNode; onRemove: () => void; mono?: boolean }) {
  const t = useT();
  return (
    <div className="group flex h-11 items-center gap-3 border-line px-4 [&+&]:border-t">
      {!mono && <PlayerHead uuid={entry.uuid ?? entry.name} name={entry.name} size={24} />}
      <div className="min-w-0 flex-1">
        <div className={mono ? "selectable truncate font-mono text-[13px] text-text" : "selectable truncate text-[13px] font-medium text-text"}>{entry.name}</div>
        {entry.reason && <div className="truncate text-[11px] text-dim">{entry.reason}</div>}
      </div>
      {right}
      <Tooltip content={t("common.remove")}>
        <IconButton label={t("common.remove")} size="sm" className="border-transparent bg-transparent opacity-60 group-hover:opacity-100" onClick={onRemove}>
          <X size={14} />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function ListCard({
  server,
  list,
  title,
  icon,
  entries,
  placeholder,
  empty,
  right,
  withReason,
  mono,
  extra,
}: {
  server: Server;
  list: ServerPlayerList;
  title: string;
  icon: ReactNode;
  entries: ServerPlayerEntry[] | undefined;
  placeholder: string;
  empty: string;
  right?: ReactNode;
  withReason?: boolean;
  mono?: boolean;
  extra?: (e: ServerPlayerEntry) => ReactNode;
}) {
  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          <span className="text-muted">{icon}</span>
          {title}
          {entries && <span className="text-[12px] font-medium text-dim">{entries.length}</span>}
        </span>
      }
      right={right}
    >
      <AddRow placeholder={placeholder} withReason={withReason} mono={mono} onAdd={(n, r) => act(server, list, "add", n, r)} />
      {!entries ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
      ) : entries.length === 0 ? (
        <div className="px-4 py-5 text-center text-[13px] text-dim">{empty}</div>
      ) : (
        <div className="scroll max-h-[320px]">
          {entries.map((e) => (
            <EntryRow key={e.uuid ?? e.name} entry={e} mono={mono} right={extra?.(e)} onRemove={() => act(server, list, "remove", e.name)} />
          ))}
        </div>
      )}
    </SettingsCard>
  );
}

function OnlineCard({ server, data }: { server: Server; data: ServerPlayers | undefined }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const running = st?.state === "running";
  const online = running ? (st?.players ?? data?.online ?? []) : [];
  const canCmd = running && !st?.detached;
  const cmd = (c: string) => api.serverCommand(server.id, c).catch((e) => toast.error(e, t("srv.console.failed")));
  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          <span className="text-muted">
            <Users size={15} />
          </span>
          {t("srv.players.online")}
          <span className="text-[12px] font-medium text-dim">
            {online.length}/{st?.max_players ?? "–"}
          </span>
        </span>
      }
    >
      {!running ? (
        <div className="px-4 py-6 text-center text-[13px] text-dim">{t("srv.players.not_running")}</div>
      ) : online.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-dim">{t("srv.players.nobody")}</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-px bg-line">
          {online.map((name) => {
            const isOp = data?.ops.some((o) => o.name.toLowerCase() === name.toLowerCase());
            return (
              <ContextMenu
                key={name}
                content={
                  <>
                    <ContextItem icon={<Crown size={14} />} disabled={isOp} onSelect={() => act(server, "ops", "add", name)}>
                      {t("srv.players.make_op")}
                    </ContextItem>
                    <ContextItem icon={<ListChecks size={14} />} onSelect={() => act(server, "whitelist", "add", name)}>
                      {t("srv.players.to_whitelist")}
                    </ContextItem>
                    <ContextSeparator />
                    <ContextItem icon={<LogOut size={14} />} disabled={!canCmd} onSelect={() => cmd(`kick ${name}`)}>
                      {t("srv.players.kick")}
                    </ContextItem>
                    <ContextItem icon={<Ban size={14} />} danger onSelect={() => act(server, "banned", "add", name)}>
                      {t("srv.players.ban")}
                    </ContextItem>
                  </>
                }
              >
                <div className="flex h-12 items-center gap-3 bg-surface px-4">
                  <PlayerHead uuid={name} name={name} size={26} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{name}</span>
                  {isOp && <Crown size={13} className="shrink-0 text-warn" />}
                </div>
              </ContextMenu>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}

export function PlayersTab({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const q = useQuery({ queryKey: sqk.players(server.id), queryFn: () => api.serverPlayers(server.id), staleTime: 15_000 });
  const [wlBusy, setWlBusy] = useState(false);

  // Join/Leave ändert u. U. Listen (z. B. Whitelist per Befehl) -> leise nachladen
  const playersKey = st?.players.join(",") ?? "";
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: sqk.players(server.id) });
  }, [playersKey, st?.state, server.id]);

  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="h-full" />;
  const d = q.data;

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

  return (
    <div className="scroll h-full">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5 px-6 py-5">
        <div className="flex flex-col gap-5">
          <OnlineCard server={server} data={d} />
          <ListCard
            server={server}
            list="whitelist"
            title={t("srv.players.whitelist")}
            icon={<ListChecks size={15} />}
            entries={d?.whitelist}
            placeholder={t("srv.players.name")}
            empty={t("srv.players.whitelist.empty")}
            right={
              <label className="flex items-center gap-2 text-[12px] text-muted">
                {d?.whitelist_enabled ? t("srv.players.whitelist.on") : t("srv.players.whitelist.off")}
                <Switch checked={!!d?.whitelist_enabled} disabled={!d || wlBusy} onChange={setWhitelist} label={t("srv.players.whitelist")} />
              </label>
            }
          />
        </div>
        <div className="flex flex-col gap-5">
          <ListCard
            server={server}
            list="ops"
            title={t("srv.players.ops")}
            icon={<Crown size={15} />}
            entries={d?.ops}
            placeholder={t("srv.players.name")}
            empty={t("srv.players.ops.empty")}
            extra={(e) => e.level !== null && <span className="font-mono text-[11px] text-dim">{t("srv.players.level", { n: e.level })}</span>}
          />
          <ListCard
            server={server}
            list="banned"
            title={t("srv.players.banned")}
            icon={<Ban size={15} />}
            entries={d?.banned}
            placeholder={t("srv.players.name")}
            empty={t("srv.players.banned.empty")}
            withReason
          />
          <ListCard
            server={server}
            list="banned_ips"
            title={t("srv.players.banned_ips")}
            icon={<ShieldOff size={15} />}
            entries={d?.banned_ips}
            placeholder="192.168.0.10"
            empty={t("srv.players.banned_ips.empty")}
            withReason
            mono
          />
        </div>
      </div>
    </div>
  );
}
