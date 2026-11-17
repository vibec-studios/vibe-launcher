// Server-Liste einer Instanz (servers.dat): Ping mit MOTD/Spielern/Latenz, Beitreten per Quick Play,
// Hinzufügen/Bearbeiten/Entfernen/Sortieren.
import { memo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Pencil, Play, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance, ServerEntry } from "@/lib/types";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Tooltip,
  cn,
  confirm,
  toast,
} from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { Motd, PingBars, usePing } from "@/components/instance/motd";
import { useT } from "@/i18n";

const key = (id: string) => ["servers", id] as const;

function Favicon({ entry, ping }: { entry: ServerEntry; ping: string | null | undefined }) {
  const src = ping ?? (entry.icon ? `data:image/png;base64,${entry.icon}` : null);
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden border border-line bg-surface2">
      {src ? <img src={src} alt="" className="h-full w-full [image-rendering:pixelated]" /> : <Server size={20} className="text-dim" />}
    </div>
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
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Play size={14} />} disabled={locked} onSelect={join}>
            {t("servers.join")}
          </ContextItem>
          <ContextItem icon={<Pencil size={14} />} disabled={locked} onSelect={() => onEdit(index)}>
            {t("servers.edit")}
          </ContextItem>
          <ContextItem icon={<Copy size={14} />} onSelect={() => navigator.clipboard?.writeText(entry.ip).then(() => toast.success(t("common.copied")))}>
            {t("servers.copy_address")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<ArrowUp size={14} />} disabled={locked || index === 0} onSelect={() => onMove(index, -1)}>
            {t("servers.up")}
          </ContextItem>
          <ContextItem icon={<ArrowDown size={14} />} disabled={locked || index === count - 1} onSelect={() => onMove(index, 1)}>
            {t("servers.down")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger disabled={locked} onSelect={() => onRemove(index)}>
            {t("common.remove")}
          </ContextItem>
        </>
      }
    >
      <div
        onDoubleClick={() => !locked && join()}
        className="group flex items-center gap-3.5 border border-line bg-surface px-3 py-2.5 transition-colors duration-100 hover:border-line2 hover:bg-surface2 data-[state=open]:border-line2 data-[state=open]:bg-surface2"
      >
        <Favicon entry={entry} ping={s?.favicon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-white">{entry.name}</span>
            <span className="truncate font-mono text-[11px] text-dim">{entry.ip}</span>
          </div>
          {ping.isLoading ? (
            <Skeleton className="mt-1.5 h-3.5 w-64" />
          ) : s?.online ? (
            <Motd text={s.motd || "–"} className="mt-0.5 line-clamp-2" />
          ) : (
            <div className="mt-0.5 text-[12px] text-danger">{s?.error ?? t("servers.offline")}</div>
          )}
        </div>
        <div className="flex w-[150px] shrink-0 flex-col items-end gap-1 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            {s?.online && <span className="tabular-nums">{s.latency_ms} ms</span>}
            <PingBars status={s} />
          </span>
          {s?.online && s.players_online != null && (
            <Tooltip content={s.players_sample.length ? s.players_sample.join(", ") : null}>
              <span className="tabular-nums">
                {s.players_online} / {s.players_max} {t("servers.players")}
              </span>
            </Tooltip>
          )}
          {s?.version && <span className="max-w-full truncate font-mono text-[11px] text-dim">{s.version}</span>}
        </div>
        <Button variant="accent" size="sm" icon={<Play size={13} fill="currentColor" />} disabled={locked} onClick={join} className="w-[104px]">
          {t("servers.join")}
        </Button>
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
      <div className="flex w-full flex-col gap-3 px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted">{q.data ? t("servers.count", { n: list.length }) : ""}</span>
          {locked && <span className="text-[12px] text-warn">{t("servers.locked")}</span>}
          <div className="flex-1" />
          <Tooltip content={t("servers.refresh")}>
            <IconButton label={t("servers.refresh")} onClick={() => qc.invalidateQueries({ queryKey: ["server-ping"] })}>
              <RefreshCw size={15} />
            </IconButton>
          </Tooltip>
          <Button variant="primary" icon={<Plus size={15} />} disabled={locked} onClick={() => setEditing(-1)}>
            {t("servers.add")}
          </Button>
        </div>
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[70px]" />)
        ) : list.length === 0 ? (
          <EmptyState
            className="mt-6 border border-dashed border-line2 bg-surface"
            icon={<Server size={32} />}
            title={t("servers.empty.title")}
            text={t("servers.empty.text")}
            action={
              <Button variant="primary" icon={<Plus size={15} />} disabled={locked} onClick={() => setEditing(-1)}>
                {t("servers.add")}
              </Button>
            }
          />
        ) : (
          <div className={cn("flex flex-col gap-2")}>
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
