// Welten & Backups eines Servers: Welten (aktive markiert), Backups erstellen/wiederherstellen/löschen.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FolderOpen, Globe2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus, waitForTask } from "@/lib/queries";
import type { Server, ServerBackup } from "@/lib/types";
import { formatBytes, formatDate, formatRelative } from "@/lib/format";
import { Button, ContextItem, ContextMenu, ContextSeparator, ErrorState, IconButton, SettingsCard, Skeleton, Tag, Tooltip, confirm, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { openServerFolder } from "./actions";

function refresh(id: string) {
  queryClient.invalidateQueries({ queryKey: sqk.backups(id) });
  queryClient.invalidateQueries({ queryKey: sqk.worlds(id) });
}

async function createBackup(server: Server, world?: string | null) {
  try {
    const task = await api.serverBackupCreate(server.id, world ?? null);
    toast.info(tt("srv.backup.started"), world ?? undefined);
    waitForTask(task)
      .then(() => toast.success(tt("srv.backup.done"), server.name))
      .catch((e) => toast.error(e, tt("srv.backup.failed")))
      .finally(() => refresh(server.id));
  } catch (e) {
    toast.error(e, tt("srv.backup.failed"));
  }
}

async function restoreBackup(server: Server, b: ServerBackup) {
  const ok = await confirm({
    title: tt("srv.backup.restore.title", { world: b.world }),
    text: tt("srv.backup.restore.text", { date: formatDate(b.created) }),
    confirmLabel: tt("srv.backup.restore"),
    danger: true,
  });
  if (!ok) return;
  try {
    const task = await api.serverBackupRestore(server.id, b.name);
    waitForTask(task)
      .then(() => toast.success(tt("srv.backup.restored"), b.world))
      .catch((e) => toast.error(e, tt("srv.backup.restore_failed")))
      .finally(() => refresh(server.id));
  } catch (e) {
    toast.error(e, tt("srv.backup.restore_failed"));
  }
}

async function deleteBackup(server: Server, b: ServerBackup) {
  const ok = await confirm({ title: tt("srv.backup.delete.title"), text: b.name, confirmLabel: tt("common.delete"), danger: true });
  if (!ok) return;
  try {
    await api.serverBackupDelete(server.id, b.name);
    queryClient.setQueryData<ServerBackup[]>(sqk.backups(server.id), (l) => l?.filter((x) => x.name !== b.name));
  } catch (e) {
    toast.error(e);
  }
}

const rowsSkeleton = (
  <div className="flex flex-col gap-2 px-4 py-3">
    {Array.from({ length: 3 }, (_, i) => (
      <Skeleton key={i} className="h-9" />
    ))}
  </div>
);

export function ServerWorldsTab({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const stopped = !st || st.state === "stopped" || st.state === "crashed";
  const worlds = useQuery({ queryKey: sqk.worlds(server.id), queryFn: () => api.serverWorlds(server.id), staleTime: 15_000 });
  const backups = useQuery({ queryKey: sqk.backups(server.id), queryFn: () => api.serverBackups(server.id), staleTime: 15_000 });
  const [busy, setBusy] = useState(false);
  const sortedBackups = [...(backups.data ?? [])].sort((a, b) => b.created - a.created);

  return (
    <div className="scroll h-full">
      <div className="grid w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-5 px-6 py-5">
        <SettingsCard
          title={
            <span className="flex items-center gap-2">
              <Globe2 size={15} className="text-muted" />
              {t("srv.worlds")}
            </span>
          }
          right={
            <Tooltip content={t("common.open_folder")}>
              <IconButton label={t("common.open_folder")} size="sm" onClick={() => openServerFolder(server, null)}>
                <FolderOpen size={14} />
              </IconButton>
            </Tooltip>
          }
        >
          {worlds.isError && !worlds.data ? (
            <ErrorState error={worlds.error} onRetry={() => worlds.refetch()} />
          ) : !worlds.data ? (
            rowsSkeleton
          ) : worlds.data.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-dim">{t("srv.worlds.empty")}</div>
          ) : (
            worlds.data.map((w) => (
              <ContextMenu
                key={w.name}
                content={
                  <>
                    <ContextItem icon={<Archive size={14} />} onSelect={() => createBackup(server, w.name)}>
                      {t("srv.backup.create")}
                    </ContextItem>
                    <ContextItem icon={<FolderOpen size={14} />} onSelect={() => openServerFolder(server, w.name)}>
                      {t("common.open_folder")}
                    </ContextItem>
                  </>
                }
              >
                <div className="flex h-12 items-center gap-3 border-line px-4 [&+&]:border-t">
                  <Globe2 size={16} className={w.active ? "text-accent" : "text-dim"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[13px] text-text">{w.name}</div>
                    <div className="text-[11px] text-dim">{formatBytes(w.size)}</div>
                  </div>
                  {w.active && <Tag color="var(--accent)">{t("srv.worlds.active")}</Tag>}
                  <Tooltip content={t("srv.backup.create")}>
                    <IconButton label={t("srv.backup.create")} size="sm" onClick={() => createBackup(server, w.name)}>
                      <Archive size={14} />
                    </IconButton>
                  </Tooltip>
                </div>
              </ContextMenu>
            ))
          )}
          <div className="border-t border-line px-4 py-2.5 text-[12px] text-dim">{t("srv.worlds.hint")}</div>
        </SettingsCard>

        <SettingsCard
          title={
            <span className="flex items-center gap-2">
              <Archive size={15} className="text-muted" />
              {t("srv.backups")}
              {backups.data && <span className="text-[12px] font-medium text-dim">{backups.data.length}</span>}
            </span>
          }
          right={
            <div className="flex items-center gap-2">
              <Tooltip content={t("common.open_folder")}>
                <IconButton label={t("common.open_folder")} size="sm" onClick={() => openServerFolder(server, "backups")}>
                  <FolderOpen size={14} />
                </IconButton>
              </Tooltip>
              <Button
                size="sm"
                variant="accent"
                icon={<Plus size={13} />}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  await createBackup(server, null);
                  setBusy(false);
                }}
              >
                {t("srv.backup.create")}
              </Button>
            </div>
          }
        >
          {backups.isError && !backups.data ? (
            <ErrorState error={backups.error} onRetry={() => backups.refetch()} />
          ) : !backups.data ? (
            rowsSkeleton
          ) : sortedBackups.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-dim">{t("srv.backups.empty")}</div>
          ) : (
            <div>
              {sortedBackups.map((b) => (
                <ContextMenu
                  key={b.name}
                  content={
                    <>
                      <ContextItem icon={<ArchiveRestore size={14} />} disabled={!stopped} onSelect={() => restoreBackup(server, b)}>
                        {t("srv.backup.restore")}
                      </ContextItem>
                      <ContextItem icon={<FolderOpen size={14} />} onSelect={() => openServerFolder(server, "backups")}>
                        {t("common.open_folder")}
                      </ContextItem>
                      <ContextSeparator />
                      <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => deleteBackup(server, b)}>
                        {t("common.delete")}
                      </ContextItem>
                    </>
                  }
                >
                  <div className="group flex h-12 items-center gap-3 border-line px-4 [&+&]:border-t">
                    <Archive size={15} className="shrink-0 text-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-text">
                        <span className="font-mono">{b.world}</span>
                        <span className="text-dim"> · {formatDate(b.created)} {new Date(b.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div className="truncate text-[11px] text-dim">
                        {formatRelative(b.created)} · {formatBytes(b.size)}
                      </div>
                    </div>
                    <Tooltip content={stopped ? t("srv.backup.restore") : t("srv.backup.restore_stopped")}>
                      <span>
                        <Button size="sm" icon={<ArchiveRestore size={13} />} disabled={!stopped} onClick={() => restoreBackup(server, b)}>
                          {t("srv.backup.restore")}
                        </Button>
                      </span>
                    </Tooltip>
                    <Tooltip content={t("common.delete")}>
                      <IconButton label={t("common.delete")} size="sm" className="hover:text-danger" onClick={() => deleteBackup(server, b)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </div>
                </ContextMenu>
              ))}
            </div>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}
