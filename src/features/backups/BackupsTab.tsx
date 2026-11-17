// Instanz-Tab „Backups“: Snapshots (Mods/Configs/Packs) und Welt-Backups (ZIP je Welt).
// Listen aktualisieren sich über `content://changed` (Query-Keys unter ["content", id] / ["worlds", id]).
import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, FolderOpen, Globe2, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useInstanceTasks } from "@/lib/queries";
import type { Instance, SnapshotInfo, WorldBackup } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { useLang, useT } from "@/i18n";
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  SettingsCard,
  Skeleton,
  Tag,
  Tooltip,
  confirm,
  toast,
} from "@/components/ui";
import { runBackupTask } from "./worldActions";

const wrap = "w-full px-6";
export const backupKeys = {
  snapshots: (id: string) => ["content", id, "snapshots"] as const,
  worlds: (id: string) => ["worlds", id, "backups"] as const,
};

function dateTime(ms: number) {
  const loc = useLang.getState().lang === "en" ? "en-US" : "de-DE";
  return new Date(ms).toLocaleString(loc, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AutoTag() {
  const t = useT();
  return (
    <Tooltip content={t("backups.auto_hint")}>
      <span>
        <Tag color="#5aa9ff">{t("backups.auto")}</Tag>
      </span>
    </Tooltip>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 [&+&]:border-t [&+&]:border-line">
      <Skeleton className="h-8 w-8" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-7 w-24" />
    </div>
  );
}

const SnapshotRow = memo(function SnapshotRow({ instance, snap, busy }: { instance: Instance; snap: SnapshotInfo; busy: boolean }) {
  const t = useT();
  const restore = async () => {
    const ok = await confirm({
      title: t("backups.snapshot.restore_title", { name: snap.name }),
      text: t("backups.snapshot.restore_text"),
      confirmLabel: t("backups.snapshot.restore"),
    });
    if (!ok) return;
    await runBackupTask(() => api.snapshotRestore(instance.id, snap.id), t("backups.snapshot.restored"), t("backups.snapshot.restore_failed"), snap.name);
  };
  const del = async () => {
    const ok = await confirm({
      title: t("backups.snapshot.delete_title", { name: snap.name }),
      text: t("backups.snapshot.delete_text"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.snapshotDelete(instance.id, snap.id);
      toast.success(t("backups.snapshot.deleted"), snap.name);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="group flex items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-surface2 [&+&]:border-t [&+&]:border-line">
      <div className="grid h-8 w-8 shrink-0 place-items-center border border-line bg-surface2 text-muted">
        <History size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-white" title={snap.name}>
            {snap.name}
          </span>
          {snap.auto && <AutoTag />}
        </div>
        <div className="truncate text-[12px] text-dim">
          {dateTime(snap.created)} · {formatRelative(snap.created)}
        </div>
      </div>
      <div className="w-[90px] text-right text-[12px] tabular-nums text-muted">{t("backups.snapshot.files", { n: snap.file_count })}</div>
      <div className="w-[80px] text-right text-[12px] tabular-nums text-dim">{formatBytes(snap.size)}</div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" icon={<RotateCcw size={13} />} disabled={busy} onClick={restore}>
          {t("backups.snapshot.restore")}
        </Button>
        <Tooltip content={t("common.delete")}>
          <IconButton label={t("common.delete")} size="sm" className="border-transparent text-danger hover:border-danger/50" disabled={busy} onClick={del}>
            <Trash2 size={14} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
});

const WorldBackupRow = memo(function WorldBackupRow({ instance, b, busy }: { instance: Instance; b: WorldBackup; busy: boolean }) {
  const t = useT();
  const restore = async () => {
    const ok = await confirm({
      title: t("backups.world.restore_title", { name: b.world_name }),
      text: t("backups.world.restore_text", { date: dateTime(b.created) }),
      confirmLabel: t("backups.snapshot.restore"),
    });
    if (!ok) return;
    await runBackupTask(() => api.worldBackupRestore(instance.id, b.id), t("backups.world.restored"), t("backups.world.restore_failed"), b.world_name);
  };
  const del = async () => {
    const ok = await confirm({
      title: t("backups.world.delete_title"),
      text: t("backups.world.delete_text", { name: b.world_name, date: dateTime(b.created) }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.worldBackupDelete(instance.id, b.id);
      toast.success(t("backups.world.deleted"));
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="group flex items-center gap-4 py-2 pl-[60px] pr-4 transition-colors duration-150 hover:bg-surface2">
      <Archive size={14} className="shrink-0 text-dim" />
      <div className="min-w-0 flex-1 truncate text-[13px] text-text">
        {dateTime(b.created)} <span className="text-dim">· {formatRelative(b.created)}</span>
      </div>
      {b.auto && <AutoTag />}
      <div className="w-[80px] text-right text-[12px] tabular-nums text-dim">{formatBytes(b.size)}</div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" icon={<RotateCcw size={13} />} disabled={busy} onClick={restore}>
          {t("backups.snapshot.restore")}
        </Button>
        <Tooltip content={t("common.delete")}>
          <IconButton label={t("common.delete")} size="sm" className="border-transparent text-danger hover:border-danger/50" disabled={busy} onClick={del}>
            <Trash2 size={14} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
});

function CreateSnapshotDialog({ instance, open, onClose }: { instance: Instance; open: boolean; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = await runBackupTask(() => api.snapshotCreate(instance.id, name.trim() || null), t("backups.snapshot.created"), t("backups.snapshot.create_failed"), name.trim() || undefined);
    setBusy(false);
    if (ok) {
      setName("");
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t("backups.snapshot.create")}
      description={t("backups.snapshot.create_text")}
      size="sm"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" icon={<Plus size={14} />} loading={busy} onClick={go}>
            {t("backups.snapshot.create")}
          </Button>
        </>
      }
    >
      <Field label={t("backups.snapshot.name")}>
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder={t("backups.snapshot.name_placeholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && go()}
        />
      </Field>
    </Dialog>
  );
}

export function BackupsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const snaps = useQuery({ queryKey: backupKeys.snapshots(instance.id), queryFn: () => api.snapshotsList(instance.id) });
  const wb = useQuery({ queryKey: backupKeys.worlds(instance.id), queryFn: () => api.worldBackupsList(instance.id) });
  const worlds = useQuery({ queryKey: qk.worlds(instance.id), queryFn: () => api.worldsList(instance.id) });
  const busy = useInstanceTasks(instance.id).some((x) => x.kind === "backup");
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, WorldBackup[]>();
    for (const b of wb.data ?? []) m.set(b.folder, [...(m.get(b.folder) ?? []), b]);
    return [...m.entries()].map(([folder, list]) => ({ folder, name: list[0].world_name, list })).sort((a, b) => b.list[0].created - a.list[0].created);
  }, [wb.data]);
  const existing = useMemo(() => new Set((worlds.data ?? []).map((w) => w.folder)), [worlds.data]);

  return (
    <div className="scroll h-full">
      <div className={`${wrap} flex flex-col gap-4 py-6`}>
        <SettingsCard
          title={t("backups.snapshots")}
          right={
            <div className="flex items-center gap-2">
              <Tooltip content={t("backups.open_folder")}>
                <IconButton
                  label={t("backups.open_folder")}
                  size="sm"
                  className="border-transparent hover:border-line2"
                  onClick={() => api.backupsOpenFolder(instance.id, "snapshots").catch((e) => toast.error(e))}
                >
                  <FolderOpen size={14} />
                </IconButton>
              </Tooltip>
              <Button size="sm" variant="accent" icon={<Plus size={13} />} disabled={busy} onClick={() => setCreating(true)}>
                {t("backups.snapshot.create")}
              </Button>
            </div>
          }
        >
          <p className="border-b border-line px-4 py-2.5 text-[12.5px] text-muted">{t("backups.snapshots.desc")}</p>
          {snaps.isError && !snaps.data ? (
            <ErrorState error={snaps.error} onRetry={() => snaps.refetch()} />
          ) : !snaps.data ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : snaps.data.length === 0 ? (
            <EmptyState className="py-10" icon={<History size={28} />} title={t("backups.snapshot.empty")} text={t("backups.snapshot.empty_text")} />
          ) : (
            <div>
              {snaps.data.map((s) => (
                <SnapshotRow key={s.id} instance={instance} snap={s} busy={busy} />
              ))}
            </div>
          )}
        </SettingsCard>

        <SettingsCard
          title={t("backups.worlds")}
          right={
            <Tooltip content={t("backups.open_folder")}>
              <IconButton
                label={t("backups.open_folder")}
                size="sm"
                className="border-transparent hover:border-line2"
                onClick={() => api.backupsOpenFolder(instance.id, "worlds").catch((e) => toast.error(e))}
              >
                <FolderOpen size={14} />
              </IconButton>
            </Tooltip>
          }
        >
          <p className="border-b border-line px-4 py-2.5 text-[12.5px] text-muted">{t("backups.worlds.desc")}</p>
          {wb.isError && !wb.data ? (
            <ErrorState error={wb.error} onRetry={() => wb.refetch()} />
          ) : !wb.data ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : groups.length === 0 ? (
            <EmptyState className="py-10" icon={<Globe2 size={28} />} title={t("backups.worlds.empty")} text={t("backups.worlds.empty_text")} />
          ) : (
            <div>
              {groups.map((g) => (
                <div key={g.folder} className="pb-1.5 [&+&]:border-t [&+&]:border-line">
                  <div className="flex items-center gap-4 px-4 pb-1 pt-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center border border-line bg-surface2 text-[#5fbf4a]">
                      <Globe2 size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-white">{g.name}</div>
                      <div className="truncate font-mono text-[11px] text-dim">
                        saves/{g.folder}
                        {worlds.data && !existing.has(g.folder) && <span className="ml-2 font-sans text-warn">· {t("backups.world.missing")}</span>}
                      </div>
                    </div>
                    <span className="text-[12px] text-dim">
                      {g.list.length === 1 ? t("backups.worlds.count_1") : t("backups.worlds.count", { n: g.list.length })}
                    </span>
                  </div>
                  {g.list.map((b) => (
                    <WorldBackupRow key={b.id} instance={instance} b={b} busy={busy} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
      </div>
      <CreateSnapshotDialog instance={instance} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
