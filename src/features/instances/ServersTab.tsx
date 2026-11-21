// Server-Liste einer Instanz (servers.dat): Ping mit MOTD/Spielern/Latenz, Beitreten per Quick Play,
// Hinzufügen/Bearbeiten/Entfernen/Sortieren.
import { memo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Info, Lock, MoreHorizontal, Pencil, Play, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance, ServerEntry } from "@/lib/types";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  Dialog,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Tooltip,
  confirm,
  toast,
  type MenuItemProps,
} from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { Motd, PingBars, usePing } from "@/components/instance/motd";
import { useT } from "@/i18n";
import { isLegacyRelayAddress } from "@/lib/domains";
import { PageTools } from "./toolbar";

const key = (id: string) => ["servers", id] as const;

function Favicon({ entry, ping }: { entry: ServerEntry; ping: string | null | undefined }) {
  const src = ping ?? (entry.icon ? `data:image/png;base64,${entry.icon}` : null);
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2">
      {src ? <img src={src} alt="" className="h-full w-full [image-rendering:pixelated]" /> : <Server size={17} className="text-dim" />}
    </div>
  );
}

interface RowMenuProps {
  entry: ServerEntry;
  index: number;
  count: number;
  locked: boolean;
  join: () => void;
  onEdit: (i: number) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
  Item: (p: MenuItemProps) => React.ReactNode;
  Sep: () => React.ReactNode;
}

/** Dieselben Einträge im ⋯-Menü und im Rechtsklick-Menü. */
function RowMenu({ entry, index, count, locked, join, onEdit, onMove, onRemove, Item, Sep }: RowMenuProps) {
  const t = useT();
  return (
    <>
      <Item icon={<Play size={14} />} disabled={locked} onSelect={join}>
        {t("servers.join")}
      </Item>
      <Item icon={<Pencil size={14} />} disabled={locked} onSelect={() => onEdit(index)}>
        {t("servers.edit")}
      </Item>
      <Item icon={<Copy size={14} />} onSelect={() => navigator.clipboard?.writeText(entry.ip).then(() => toast.success(t("common.copied")))}>
        {t("servers.copy_address")}
      </Item>
      <Sep />
      <Item icon={<ArrowUp size={14} />} disabled={locked || index === 0} onSelect={() => onMove(index, -1)}>
        {t("servers.up")}
      </Item>
      <Item icon={<ArrowDown size={14} />} disabled={locked || index === count - 1} onSelect={() => onMove(index, 1)}>
        {t("servers.down")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger disabled={locked} onSelect={() => onRemove(index)}>
        {t("common.remove")}
      </Item>
    </>
  );
}

const ServerRow = memo(function ServerRow({
  instance,
  entry,
  index,
  count,
  locked,
  onEdit,
  onMove,
  onRemove,
}: {
  instance: Instance;
  entry: ServerEntry;
  index: number;
  count: number;
  locked: boolean;
  onEdit: (i: number) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
}) {
  const t = useT();
  const { launch } = useInstanceActions();
  const ping = usePing(entry.ip);
  const s = ping.data;
  const join = () => launch(instance, null, entry.ip);
  const menu = { entry, index, count, locked, join, onEdit, onMove, onRemove };
  return (
    <ContextMenu content={<RowMenu {...menu} Item={ContextItem} Sep={ContextSeparator} />}>
      <div
        onDoubleClick={() => !locked && join()}
        className="group flex h-14 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04]"
      >
        <Favicon entry={entry} ping={s?.favicon} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-text">{entry.name}</span>
            <span className="truncate font-mono text-[11px] text-dim">{entry.ip}</span>
          </div>
          {ping.isLoading ? (
            <Skeleton className="mt-1 h-3 w-56" />
          ) : s?.online ? (
            <Motd text={s.motd || "–"} className="line-clamp-1 text-[12px] leading-tight" />
          ) : (
            <div className="truncate text-[12px] leading-tight text-danger">{s?.error ?? t("servers.offline")}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[12px] text-muted">
          {s?.online && s.players_online != null && (
            <Tooltip content={s.players_sample.length ? s.players_sample.join(", ") : null}>
              <span className="tabular-nums">
                {s.players_online}/{s.players_max}
              </span>
            </Tooltip>
          )}
          <Tooltip content={s?.online ? [`${s.latency_ms} ms`, s.version].filter(Boolean).join(" · ") : null}>
            <span className="flex items-center">
              <PingBars status={s} />
            </span>
          </Tooltip>
        </div>
        <IconButton label={t("servers.join_with", { name: instance.name })} tip size="sm" variant="ghost" disabled={locked} className="text-accent" onClick={join}>
          <Play size={14} fill="currentColor" />
        </IconButton>
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <RowMenu {...menu} Item={DropdownItem} Sep={DropdownSeparator} />
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
});

function EditDialog({ entry, onSave, onClose }: { entry: ServerEntry; onSave: (e: ServerEntry) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(entry.name);
  const [ip, setIp] = useState(entry.ip);
  const [tex, setTex] = useState<"prompt" | "enabled" | "disabled">(entry.accept_textures == null ? "prompt" : entry.accept_textures ? "enabled" : "disabled");
  const valid = ip.trim().length > 0 && /^[A-Za-z0-9.\-_:[\]]+$/.test(ip.trim());
  const save = () =>
    valid && onSave({ ...entry, name: name.trim() || t("servers.default_name"), ip: ip.trim(), accept_textures: tex === "prompt" ? null : tex === "enabled" });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={entry.ip ? t("servers.edit") : t("servers.add")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) save();
        }}
      >
        <Field label={t("servers.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("servers.default_name")} maxLength={64} autoFocus />
        </Field>
        <Field label={t("servers.address")} error={ip && !valid ? t("servers.address_invalid") : undefined}>
          <Input className="font-mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="play.example.net" maxLength={255} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="label">{t("servers.resourcepacks")}</span>
          <Select
            value={tex}
            onChange={(v) => setTex(v as typeof tex)}
            options={[
              { value: "prompt", label: t("servers.rp.prompt") },
              { value: "enabled", label: t("servers.rp.enabled") },
              { value: "disabled", label: t("servers.rp.disabled") },
            ]}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** Domain-Umzug: Hinweis bei Adressen `*.vibey.henny.dev` mit Knopf „Auf .axolite.cc umstellen“ (gleicher Name). */
function LegacyAddressNotice({ instance, list, locked }: { instance: Instance; list: ServerEntry[]; locked: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const n = list.filter((s) => isLegacyRelayAddress(s.ip)).length;
  if (!n) return null;
  const run = async () => {
    setBusy(true);
    try {
      await api.instanceServersModernize(instance.id);
      toast.success(t("notice.servers.done"));
    } catch (e) {
      toast.error(e, t("notice.servers.failed"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: key(instance.id) });
    }
  };
  return (
    <div role="status" className="mx-6 mb-2 flex items-center gap-3 rounded-card bg-brand/[.07] px-3.5 py-2.5">
      <Info size={16} className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{t("notice.servers.title")}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{n === 1 ? t("notice.servers.text_one") : t("notice.servers.text_many", { n })}</p>
      </div>
      <Tooltip content={locked ? t("servers.locked") : null}>
        <span>
          <Button size="sm" variant="accent" loading={busy} disabled={locked || busy} onClick={run}>
            {t("notice.servers.action")}
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}

export function ServersTab({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(instance.id), queryFn: () => api.instanceServersList(instance.id) });
  const { phase } = useRunPhase(instance.id);
  const locked = phase !== "idle";
  const [editing, setEditing] = useState<number | null>(null);
  const list = q.data ?? [];

  const save = async (next: ServerEntry[]) => {
    const prev = q.data;
    qc.setQueryData(key(instance.id), next);
    try {
      await api.instanceServersSave(instance.id, next);
    } catch (e) {
      qc.setQueryData(key(instance.id), prev);
      toast.error(e, t("servers.save_failed"));
    }
  };
  const onMove = (i: number, d: -1 | 1) => {
    const next = list.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    save(next);
  };
  const onRemove = async (i: number) => {
    if (!(await confirm({ title: t("servers.remove_title", { name: list[i].name }), confirmLabel: t("common.remove"), danger: true }))) return;
    save(list.filter((_, j) => j !== i));
  };
  const blank: ServerEntry = { name: "", ip: "", icon: null, accept_textures: null, hidden: false };

  return (
    <div className="scroll h-full">
      <PageTools>
        {locked && (
          <Tooltip content={t("servers.locked")}>
            <span className="grid h-9 w-9 place-items-center text-warn" aria-label={t("servers.locked")}>
              <Lock size={14} />
            </span>
          </Tooltip>
        )}
        <div className="flex-1" />
        <IconButton label={t("servers.refresh")} tip variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["server-ping"] })}>
          <RefreshCw size={16} />
        </IconButton>
        {/* Leer: „Server hinzufügen“ steht groß im Leerzustand */}
        {list.length > 0 && (
          <Button variant="accent" icon={<Plus size={16} />} disabled={locked} onClick={() => setEditing(-1)}>
            {t("servers.add")}
          </Button>
        )}
      </PageTools>
      <div className="pb-6">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-1 px-6">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Server size={32} />}
            title={t("servers.empty.title")}
            text={t("servers.empty.text")}
            action={
              <Button size="sm" variant="accent" icon={<Plus size={14} />} disabled={locked} onClick={() => setEditing(-1)}>
                {t("servers.add")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col">
            <LegacyAddressNotice instance={instance} list={list} locked={locked} />
            {list.map((s, i) => (
              <ServerRow
                key={`${s.ip}-${i}`}
                instance={instance}
                entry={s}
                index={i}
                count={list.length}
                locked={locked}
                onEdit={setEditing}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
      </div>
      {editing !== null && (
        <EditDialog
          entry={editing >= 0 ? list[editing] : blank}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            save(editing >= 0 ? list.map((x, j) => (j === editing ? e : x)) : [...list, e]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
