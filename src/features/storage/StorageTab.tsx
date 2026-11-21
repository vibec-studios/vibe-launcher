import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Combine, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, SettingRow, SettingsCard, Spinner, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format";
import { waitForTask } from "@/lib/queries";
import { DataDirRow } from "@/features/settings/DataDirMove";
import { storageApi, storageKey, type CategoryId, type CleanTarget, type StorageCategory, type StorageUsage } from "./api";
import { InstanceStorage } from "./InstanceStorage";

const ACTIONS: Partial<Record<CategoryId, { target: CleanTarget; danger?: boolean }>> = {
  mod_caches: { target: "mod_caches" },
  instance_logs: { target: "instance_logs" },
  cache: { target: "cache" },
  launcher_logs: { target: "launcher_logs" },
  snapshots: { target: "snapshots" },
  orphan_world_backups: { target: "orphan_world_backups", danger: true },
  vibey: { target: "vibey" },
};

const HIDDEN_WHEN_EMPTY: CategoryId[] = ["orphan_world_backups", "store", "webview", "servers", "vibey"];

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 && value > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function CategoryRow({ c, max, onClean, busy }: { c: StorageCategory; max: number; onClean: (c: StorageCategory) => void; busy: boolean }) {
  const t = useT();
  const action = ACTIONS[c.id];
  return (
    <SettingRow
      title={
        <span className="flex items-center gap-2">
          {t(`disk.cat.${c.id}`)}
          <span className="text-caption font-semibold tabular-nums text-dim">{formatBytes(c.bytes)}</span>
        </span>
      }
      description={
        <span className="flex flex-col gap-1.5">
          <span>{t(`disk.cat.${c.id}.desc`)}</span>
          <Bar value={c.bytes} max={max} />
        </span>
      }
    >
      {action && (
        <Button size="sm" variant={action.danger ? "danger" : "ghost"} icon={<Trash2 size={13} />} disabled={busy || c.cleanable <= 0} onClick={() => onClean(c)}>
          {c.cleanable > 0 ? t("disk.clean_size", { size: formatBytes(c.cleanable) }) : t("disk.clean_nothing")}
        </Button>
      )}
    </SettingRow>
  );
}

function Summary({ u, onDedup, busy, onRefresh, fetching }: { u: StorageUsage; onDedup: () => void; busy: boolean; onRefresh: () => void; fetching: boolean }) {
  const t = useT();
  return (
    <SettingsCard
      title={t("disk.title")}
      right={
        <Button size="sm" variant="subtle" icon={<RefreshCw size={13} />} loading={fetching} onClick={onRefresh}>
          {t("disk.refresh")}
        </Button>
      }
    >
      <SettingRow
        title={<span className="text-section tabular-nums">{t("disk.total", { size: formatBytes(u.total) })}</span>}
        description={
          <span className="flex flex-col gap-0.5">
            {u.free !== null && <span>{t("disk.free", { size: formatBytes(u.free) })}</span>}
            {u.shared_saved > 0 && <span className="text-ok">{t("disk.shared_saved", { size: formatBytes(u.shared_saved) })}</span>}
          </span>
        }
      />
      <SettingRow title={t("disk.dedup")} description={t("disk.dedup.desc")}>
        <Button size="sm" variant="primary" icon={<Combine size={13} />} loading={busy} disabled={busy} onClick={onDedup}>
          {t("disk.dedup.run")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

export function StorageTab({ dataDir }: { dataDir: string | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: storageKey, queryFn: storageApi.usage, staleTime: 0, gcTime: 60_000, placeholderData: undefined });
  const [busy, setBusy] = useState(false);
  const u = q.data;

  const refresh = async () => (await q.refetch()).data;

  const clean = async (c: StorageCategory) => {
    const action = ACTIONS[c.id];
    if (!action) return;
    const ok = await confirm({
      title: t(`disk.confirm.${c.id}`),
      text: t(`disk.confirm.${c.id}.text`, { size: formatBytes(c.cleanable) }),
      confirmLabel: t("disk.clean"),
      danger: action.danger,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const freed = await storageApi.clean(action.target);
      toast.success(t("disk.freed", { size: formatBytes(freed) }));
      await refresh();
    } catch (e) {
      toast.error(e, t("disk.failed"));
    } finally {
      setBusy(false);
    }
  };

  const dedup = async () => {
    const ok = await confirm({ title: t("disk.dedup"), text: t("disk.dedup.confirm"), confirmLabel: t("disk.dedup.run") });
    if (!ok) return;
    setBusy(true);
    const before = u?.total ?? 0;
    try {
      await waitForTask(await storageApi.dedup());
      const after = (await refresh())?.total ?? before;
      toast.success(t("disk.freed", { size: formatBytes(Math.max(0, before - after)) }));
    } catch (e) {
      toast.error(e, t("disk.failed"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: storageKey });
    }
  };

  const cats = (u?.categories ?? []).filter((c) => c.bytes > 0 || !HIDDEN_WHEN_EMPTY.includes(c.id));
  const max = Math.max(1, ...cats.map((c) => c.bytes));
  return (
    <>
      <SettingsCard title={t("settings.section.storage")}>
        <DataDirRow dataDir={dataDir} />
      </SettingsCard>
      {!u ? (
        <div className="flex items-center justify-center gap-2 py-10 text-meta text-muted">
          <Spinner size={14} />
          {t("disk.scanning")}
        </div>
      ) : (
        <>
          <Summary u={u} onDedup={dedup} busy={busy} onRefresh={() => void refresh()} fetching={q.isFetching} />
          <SettingsCard title={t("disk.categories")}>
            {cats.map((c) => (
              <CategoryRow key={c.id} c={c} max={max} onClean={clean} busy={busy} />
            ))}
          </SettingsCard>
          <InstanceStorage instances={u.instances} onChanged={() => void refresh()} />
        </>
      )}
    </>
  );
}
