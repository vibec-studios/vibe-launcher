// Sicherungen der Bedrock-Welten (.mcworld im Launcher-Ordner): neu anlegen, zurückspielen, löschen.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FolderOpen, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Instance, WorldBackup } from "@/lib/types";
import { formatBytes, formatDate, formatRelative } from "@/lib/format";
import { Button, DropdownItem, DropdownMenu, EmptyState, ErrorState, IconButton, Skeleton, Tag, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { bedrockApi, bqk } from "./api";
import { backupBedrockWorld } from "./WorldsTab";

function BackupRow({ instance, b }: { instance: Instance; b: WorldBackup }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: bqk.backups(instance.id) });
    qc.invalidateQueries({ queryKey: bqk.worlds(instance.id) });
  };
  const restore = async () => {
    const ok = await confirm({
      title: t("bedrock.backups.restore_title", { name: b.world_name }),
      text: t("bedrock.backups.restore_text", { when: formatDate(b.created) }),
      confirmLabel: t("backups.snapshot.restore"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await bedrockApi.backupRestore(instance.id, b.id);
      toast.success(t("bedrock.backups.restored"), b.world_name);
      refresh();
    } catch (e) {
      toast.error(e, t("backups.snapshot.restore_failed"));
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    const ok = await confirm({ title: t("bedrock.backups.delete_title"), text: t("bedrock.backups.delete_text"), confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await bedrockApi.backupDelete(instance.id, b.id);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="group flex h-12 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03]">
      <History size={16} className="shrink-0 text-dim" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-text">{formatDate(b.created)}</span>
          {b.auto && <Tag>{t("bedrock.backups.auto")}</Tag>}
        </div>
        <div className="truncate text-[12px] leading-tight text-dim">
          {formatRelative(b.created)} · {formatBytes(b.size)}
        </div>
      </div>
      <Button size="sm" variant="subtle" loading={busy} icon={<RotateCcw size={13} />} className="opacity-70 group-hover:opacity-100" onClick={() => void restore()}>
        {t("backups.snapshot.restore")}
      </Button>
      <IconButton label={t("common.delete")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => void del()}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

export function BedrockBackupsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: bqk.backups(instance.id), queryFn: () => bedrockApi.backups(instance.id) });
  const worlds = useQuery({ queryKey: bqk.worlds(instance.id), queryFn: () => bedrockApi.worlds(instance.id) });
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: WorldBackup[] }>();
    for (const b of q.data ?? []) {
      const g = m.get(b.folder) ?? { name: b.world_name, items: [] };
      g.items.push(b);
      m.set(b.folder, g);
    }
    return [...m.entries()];
  }, [q.data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-6 pt-2">
        <div className="min-w-0 flex-1 text-[12.5px] text-muted">{t("bedrock.backups.desc")}</div>
        <IconButton label={t("bedrock.backups.open_folder")} tip variant="ghost" onClick={() => bedrockApi.openFolder(instance.id, "backups").catch((e) => toast.error(e))}>
          <FolderOpen size={16} />
        </IconButton>
        <DropdownMenu
          align="end"
          trigger={
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={!worlds.data?.length}>
              {t("bedrock.backups.create")}
            </Button>
          }
        >
          {(worlds.data ?? []).map((w) => (
            <DropdownItem key={w.folder} icon={<Archive size={14} />} onSelect={() => void backupBedrockWorld(instance, w, () => qc.invalidateQueries({ queryKey: bqk.backups(instance.id) }))}>
              {w.name}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </div>
      <div className="scroll min-h-0 flex-1 pb-6">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-2 px-6 pt-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState icon={<Archive size={34} />} title={t("bedrock.backups.empty.title")} text={t("bedrock.backups.empty.text")} />
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([folder, g]) => (
              <section key={folder}>
                <div className="px-6 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-dim">{g.name}</div>
                {g.items.map((b) => (
                  <BackupRow key={b.id} instance={instance} b={b} />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
