// Instanz-Tab „Backups“: Snapshots (Mods/Configs/Packs) und Welt-Backups (ZIP je Welt).
// Listen aktualisieren sich über `content://changed` (Query-Keys unter ["content", id] / ["worlds", id]).
import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Globe2, History, MoreHorizontal, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useInstanceTasks } from "@/lib/queries";
import type { Instance, SnapshotInfo, WorldBackup } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { useLang, useT } from "@/i18n";
import {
  Button,
  Dialog,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Skeleton,
  Tag,
  Tooltip,
  confirm,
  toast,
} from "@/components/ui";
import { runBackupTask } from "./worldActions";
import { PageTools } from "@/features/instances/toolbar";

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
    <div className="flex h-12 items-center gap-3 px-6">
      <Skeleton className="h-4 w-4" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
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
    <div className="group flex h-12 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03]">
      <History size={15} className="shrink-0 text-dim" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-text" title={snap.name}>
            {snap.name}
          </span>
          {snap.auto && <AutoTag />}
        </div>
        <div className="truncate text-[12px] leading-tight text-dim">
          {dateTime(snap.created)} · {formatRelative(snap.created)} · {t("backups.snapshot.files", { n: snap.file_count })} · {formatBytes(snap.size)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label={t("backups.snapshot.restore")} tip size="sm" variant="ghost" disabled={busy} onClick={restore} className="opacity-60 group-hover:opacity-100">
          <RotateCcw size={14} />
        </IconButton>
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<RotateCcw size={14} />} disabled={busy} onSelect={() => void restore()}>
            {t("backups.snapshot.restore")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Trash2 size={14} />} danger disabled={busy} onSelect={() => void del()}>
            {t("common.delete")}
          </DropdownItem>
        </DropdownMenu>
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
    <div className="group flex h-9 items-center gap-3 pl-[52px] pr-6 transition-colors duration-100 hover:bg-white/[.03]">
      <div className="min-w-0 flex-1 truncate text-[13px] text-text">
        {dateTime(b.created)} <span className="text-dim">· {formatRelative(b.created)} · {formatBytes(b.size)}</span>
      </div>
      {b.auto && <AutoTag />}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label={t("backups.snapshot.restore")} tip size="sm" variant="ghost" disabled={busy} onClick={restore} className="opacity-60 group-hover:opacity-100">
          <RotateCcw size={14} />
        </IconButton>
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<RotateCcw size={14} />} disabled={busy} onSelect={() => void restore()}>
            {t("backups.snapshot.restore")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Trash2 size={14} />} danger disabled={busy} onSelect={() => void del()}>
            {t("common.delete")}
          </DropdownItem>
        </DropdownMenu>
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
      <PageTools>
        <div className="flex-1" />
        <DropdownMenu
          trigger={
            <IconButton label={t("backups.open_folder")} tip variant="ghost" className="data-[state=open]:bg-white/[.07]">
              <FolderOpen size={16} />
            </IconButton>
          }
        >
          <DropdownItem icon={<History size={14} />} onSelect={() => api.backupsOpenFolder(instance.id, "snapshots").catch((e) => toast.error(e))}>
            {t("backups.snapshots")}
          </DropdownItem>
          <DropdownItem icon={<Globe2 size={14} />} onSelect={() => api.backupsOpenFolder(instance.id, "worlds").catch((e) => toast.error(e))}>
            {t("backups.worlds")}
          </DropdownItem>
        </DropdownMenu>
        <IconButton label={t("backups.snapshot.create")} tip variant="accent" disabled={busy} onClick={() => setCreating(true)}>
          <Plus size={17} />
        </IconButton>
      </PageTools>
      <div className="flex flex-col gap-6 pb-8 pt-1">
        <section>
          <div className="px-6 pb-1">
            <h3 className="text-section text-text">{t("backups.snapshots")}</h3>
            <p className="text-[12px] text-dim">{t("backups.snapshots.desc")}</p>
          </div>
          {snaps.isError && !snaps.data ? (
            <ErrorState error={snaps.error} onRetry={() => snaps.refetch()} />
          ) : !snaps.data ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : snaps.data.length === 0 ? (
            <EmptyState className="py-8" icon={<History size={26} />} title={t("backups.snapshot.empty")} text={t("backups.snapshot.empty_text")} />
          ) : (
            <div>
              {snaps.data.map((s) => (
                <SnapshotRow key={s.id} instance={instance} snap={s} busy={busy} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="px-6 pb-1">
            <h3 className="text-section text-text">{t("backups.worlds")}</h3>
            <p className="text-[12px] text-dim">{t("backups.worlds.desc")}</p>
          </div>
          {wb.isError && !wb.data ? (
            <ErrorState error={wb.error} onRetry={() => wb.refetch()} />
          ) : !wb.data ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : groups.length === 0 ? (
            <EmptyState className="py-8" icon={<Globe2 size={26} />} title={t("backups.worlds.empty")} text={t("backups.worlds.empty_text")} />
          ) : (
            <div>
              {groups.map((g) => (
                <div key={g.folder} className="pb-1">
                  <div className="flex h-11 items-center gap-3 px-6">
                    <Globe2 size={15} className="shrink-0 text-[#5fbf4a]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-text">{g.name}</div>
                      <div className="truncate text-[12px] leading-tight text-dim">
                        <span className="font-mono text-[11px]">saves/{g.folder}</span>
                        {worlds.data && !existing.has(g.folder) && <span className="ml-2 text-warn">· {t("backups.world.missing")}</span>}
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
        </section>
      </div>
      <CreateSnapshotDialog instance={instance} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
