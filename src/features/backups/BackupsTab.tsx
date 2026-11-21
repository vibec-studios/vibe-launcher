// Instanz-Tab „Backups“: Snapshots (Mods/Configs/Packs) und Welt-Backups (ZIP je Welt).
// Listen aktualisieren sich über `content://changed` (Query-Keys unter ["content", id] / ["worlds", id]).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Globe2, History, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useInstanceTasks } from "@/lib/queries";
import type { Instance, WorldBackup } from "@/lib/types";
import { useT } from "@/i18n";
import { Button, ErrorState, IconButton, toast } from "@/components/ui";
import { HelpLink } from "@/features/help/HelpButton";
import { CreateSnapshotDialog } from "./components/CreateSnapshotDialog";
import { RowSkeleton, SectionEmpty, SectionHead } from "./components/parts";
import { SnapshotRow } from "./components/SnapshotRow";
import { WorldBackupRow } from "./components/WorldBackupRow";

export const backupKeys = {
  snapshots: (id: string) => ["content", id, "snapshots"] as const,
  worlds: (id: string) => ["worlds", id, "backups"] as const,
};

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

  const openFolder = (kind: "snapshots" | "worlds") => api.backupsOpenFolder(instance.id, kind).catch((e) => toast.error(e));

  // Jede Liste hat ihren eigenen Kopf mit den passenden Aktionen (statt eines unbeschrifteten „+“ über allem)
  return (
    <div className="scroll h-full">
      <div data-tour="backups-list" className="flex flex-col gap-7 pb-8 pt-5">
        <section>
          <SectionHead
            title={t("backups.snapshots")}
            desc={t("backups.snapshots.desc")}
            actions={
              <>
                <IconButton label={t("backups.open_folder")} tip variant="ghost" size="sm" onClick={() => openFolder("snapshots")}>
                  <FolderOpen size={15} />
                </IconButton>
                <HelpLink guide="backups" className="h-8 w-8 rounded-ctl" />
                <Button size="sm" variant="accent" data-tour="backups-create" icon={<Plus size={15} />} disabled={busy} onClick={() => setCreating(true)}>
                  {t("backups.snapshot.create")}
                </Button>
              </>
            }
          />
          {snaps.isError && !snaps.data ? (
            <ErrorState error={snaps.error} onRetry={() => snaps.refetch()} />
          ) : !snaps.data ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : snaps.data.length === 0 ? (
            <SectionEmpty icon={<History size={18} />} title={t("backups.snapshot.empty")} text={t("backups.snapshot.empty_text")} />
          ) : (
            <div>
              {snaps.data.map((s) => (
                <SnapshotRow key={s.id} instance={instance} snap={s} busy={busy} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHead
            title={t("backups.worlds")}
            desc={t("backups.worlds.desc")}
            actions={
              <IconButton label={t("backups.open_folder")} tip variant="ghost" size="sm" onClick={() => openFolder("worlds")}>
                <FolderOpen size={15} />
              </IconButton>
            }
          />
          {wb.isError && !wb.data ? (
            <ErrorState error={wb.error} onRetry={() => wb.refetch()} />
          ) : !wb.data ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : groups.length === 0 ? (
            <SectionEmpty icon={<Globe2 size={18} />} title={t("backups.worlds.empty")} text={t("backups.worlds.empty_text")} />
          ) : (
            <div>
              {groups.map((g) => (
                <div key={g.folder} className="pb-1">
                  <div className="flex h-11 items-center gap-3 px-6" title={`saves/${g.folder}`}>
                    <Globe2 size={15} className="shrink-0 text-[#5fbf4a]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-text">{g.name}</div>
                      <div className="truncate text-[12px] leading-tight text-dim">
                        {g.list.length === 1 ? t("backups.worlds.count_1") : t("backups.worlds.count", { n: g.list.length })}
                        {worlds.data && !existing.has(g.folder) && <span className="text-warn"> · {t("backups.world.missing")}</span>}
                      </div>
                    </div>
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
