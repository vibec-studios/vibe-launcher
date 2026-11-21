import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Crown, LogOut, Plus, X } from "lucide-react";
import type { ServerPlayerEntry, ServerPlayerList, ServerPlayers, ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { useT, type Key } from "@/i18n";
import { Button, Card, Empty, IconButton, Input, Notice, Spinner, Switch, toast } from "@/components/ui";

function Avatar({ name }: { name: string }) {
  return <img src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/28`} alt="" loading="lazy" className="size-7 shrink-0 rounded-xs bg-surface3" />;
}

function AddForm({ onAdd, pending, placeholder, withReason }: { onAdd: (name: string, reason?: string) => void; pending: boolean; placeholder: string; withReason?: boolean }) {
  const t = useT();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), reason.trim() || undefined);
        setName("");
        setReason("");
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} className="min-w-[160px] flex-1" />
      {withReason && <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("players.reason")} className="min-w-[160px] flex-1" />}
      <Button type="submit" variant="ghost" icon={<Plus size={15} />} loading={pending} disabled={!name.trim()}>
        {t("common.add")}
      </Button>
    </form>
  );
}

function Entries({ items, onRemove, empty, removeLabel, extra }: { items: ServerPlayerEntry[]; onRemove?: (n: string) => void; empty: string; removeLabel: string; extra?: (e: ServerPlayerEntry) => React.ReactNode }) {
  if (!items.length) return <p className="py-2 text-meta text-dim">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {items.map((e) => (
        <li key={e.name} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
          <Avatar name={e.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">{e.name}</div>
            {extra?.(e)}
          </div>
          {onRemove && (
            <IconButton label={removeLabel} size="sm" tone="danger" onClick={() => onRemove(e.name)}>
              <X size={15} />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PlayersTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const qc = useQueryClient();
  const qkey = [key, s.id, "players", (s.status?.players ?? []).join(",")];
  const players = useQuery({ queryKey: qkey, queryFn: () => api.players(s.id) });
  const manage = can("servers.manage");
  const running = s.status?.state === "running";
  const set = (p: ServerPlayers) => qc.setQueryData(qkey, p);
  const action = useMutation({
    mutationFn: (a: { list: ServerPlayerList; action: "add" | "remove"; name: string; reason?: string }) => api.playerAction(s.id, a.list, a.action, a.name, a.reason),
    onSuccess: (p, a) => {
      set(p);
      toast.ok(t(`players.done.${a.list}.${a.action}` as Key, { name: a.name }));
    },
    onError: (e) => toast.error(e),
  });
  const whitelist = useMutation({ mutationFn: (on: boolean) => api.setWhitelist(s.id, on), onSuccess: set, onError: (e) => toast.error(e) });
  const kick = useMutation({ mutationFn: (name: string) => api.command(s.id, `kick ${name}`), onSuccess: (_, n) => toast.ok(t("players.kicked", { name: n })), onError: (e) => toast.error(e) });

  if (players.isLoading) return <div className="flex justify-center py-12 text-muted"><Spinner size={22} /></div>;
  if (players.error || !players.data) return <Notice tone="danger">{(players.error as Error | null)?.message}</Notice>;
  const p = players.data;
  const add = (list: ServerPlayerList) => (name: string, reason?: string) => action.mutate({ list, action: "add", name, reason });
  const remove = (list: ServerPlayerList) => (manage ? (name: string) => action.mutate({ list, action: "remove", name }) : undefined);
  const isOp = (n: string) => p.ops.some((o) => o.name.toLowerCase() === n.toLowerCase());

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("players.online", { n: running ? p.online.length : 0 })} className="lg:col-span-2">
        {!running || p.online.length === 0 ? (
          <Empty title={running ? t("overview.nobody") : t("servers.offline")} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {p.online.map((n) => (
              <li key={n} className="flex items-center gap-3 rounded-ctl bg-surface2 p-2.5">
                <Avatar name={n} />
                <span className="min-w-0 flex-1 truncate font-medium">{n}</span>
                {manage && (
                  <>
                    {!isOp(n) && (
                      <IconButton label={t("players.make_op")} size="sm" onClick={() => action.mutate({ list: "ops", action: "add", name: n })}>
                        <Crown size={15} />
                      </IconButton>
                    )}
                    <IconButton label={t("players.kick")} size="sm" onClick={() => kick.mutate(n)}>
                      <LogOut size={15} />
                    </IconButton>
                    <IconButton label={t("players.ban")} size="sm" tone="danger" onClick={() => action.mutate({ list: "banned", action: "add", name: n })}>
                      <Ban size={15} />
                    </IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title={t("players.whitelist")}
        desc={t("players.whitelist_desc")}
        actions={<Switch checked={p.whitelist_enabled} disabled={!manage || whitelist.isPending} onChange={(v) => whitelist.mutate(v)} label={t("players.whitelist")} />}
      >
        {!p.whitelist_enabled && <p className="mb-2 text-meta text-warn">{t("players.whitelist_off")}</p>}
        <Entries items={p.whitelist} onRemove={remove("whitelist")} empty={t("players.empty")} removeLabel={t("common.remove")} />
        {manage && <AddForm onAdd={add("whitelist")} pending={action.isPending} placeholder={t("players.name")} />}
      </Card>
      <Card title={t("players.ops")} desc={t("players.ops_desc")}>
        <Entries items={p.ops} onRemove={remove("ops")} empty={t("players.empty")} removeLabel={t("common.remove")} extra={(e) => e.level != null && <div className="text-caption text-dim">{t("players.level", { n: e.level })}</div>} />
        {manage && <AddForm onAdd={add("ops")} pending={action.isPending} placeholder={t("players.name")} />}
      </Card>
      <Card title={t("players.banned")} desc={t("players.banned_desc")} className="lg:col-span-2">
        <Entries items={p.banned} onRemove={remove("banned")} empty={t("players.empty")} removeLabel={t("players.unban")} extra={(e) => e.reason && <div className="truncate text-caption text-dim">{e.reason}</div>} />
        {manage && <AddForm onAdd={add("banned")} pending={action.isPending} placeholder={t("players.name")} withReason />}
      </Card>
    </div>
  );
}
