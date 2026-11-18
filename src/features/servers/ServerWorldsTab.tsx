// Welten & Backups eines Servers: Werkzeugleiste (Ordner, „Backup erstellen“) über zwei flachen Listen –
// Welten (aktive markiert) und Backups (wiederherstellen/löschen). Zeilenaktionen im ⋯-Menü bzw. per Rechtsklick.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FolderOpen, Globe2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus, waitForTask } from "@/lib/queries";
import type { Server, ServerBackup } from "@/lib/types";
import { formatBytes, formatDate, formatRelative } from "@/lib/format";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  ErrorState,
  IconButton,
  SettingsCard,
  Skeleton,
  Tag,
  Tooltip,
  confirm,
  toast,
  type MenuItemProps,
} from "@/components/ui";
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

// ------------------------------------------------------------------ Zeilenaktionen (⋯ + Rechtsklick)

interface Kit {
  Item: (p: MenuItemProps) => ReactNode;
  Sep: () => ReactNode;
}
const contextKit: Kit = { Item: ContextItem, Sep: ContextSeparator };
const dropdownKit: Kit = { Item: DropdownItem, Sep: DropdownSeparator };

const rowCls =
  "group flex h-12 items-center gap-3 border-line px-4 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04] [&+&]:border-t";

function MoreMenu({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <DropdownMenu
      trigger={
        <IconButton label={t("common.more")} tip variant="ghost" size="sm" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      {children}
    </DropdownMenu>
  );
}

function WorldItems({ server, world, kit: { Item } }: { server: Server; world: string; kit: Kit }) {
  const t = useT();
  return (
    <>
      <Item icon={<Archive size={14} />} onSelect={() => createBackup(server, world)}>
        {t("srv.backup.create")}
      </Item>
      <Item icon={<FolderOpen size={14} />} onSelect={() => openServerFolder(server, world)}>
        {t("common.open_folder")}
      </Item>
    </>
  );
}

function BackupItems({ server, backup, stopped, kit: { Item, Sep } }: { server: Server; backup: ServerBackup; stopped: boolean; kit: Kit }) {
  const t = useT();
  return (
    <>
      <Item icon={<ArchiveRestore size={14} />} disabled={!stopped} onSelect={() => restoreBackup(server, backup)}>
        {t("srv.backup.restore")}
      </Item>
      <Item icon={<FolderOpen size={14} />} onSelect={() => openServerFolder(server, "backups")}>
        {t("common.open_folder")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger onSelect={() => deleteBackup(server, backup)}>
        {t("common.delete")}
      </Item>
    </>
  );
}

const rowsSkeleton = (
  <div className="flex flex-col gap-2 px-4 py-3">
    {Array.from({ length: 3 }, (_, i) => (
      <Skeleton key={i} className="h-9" />
    ))}
  </div>
);

const count = (n: number | undefined) => (n === undefined ? null : <span className="ml-1.5 text-[12px] font-medium text-dim">{n}</span>);

export function ServerWorldsTab({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const stopped = !st || st.state === "stopped" || st.state === "crashed";
  const worlds = useQuery({ queryKey: sqk.worlds(server.id), queryFn: () => api.serverWorlds(server.id), staleTime: 15_000 });
  const backups = useQuery({ queryKey: sqk.backups(server.id), queryFn: () => api.serverBackups(server.id), staleTime: 15_000 });
  const [busy, setBusy] = useState(false);
  const sortedBackups = [...(backups.data ?? [])].sort((a, b) => b.created - a.created);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-6">
        <p className="min-w-0 flex-1 truncate text-meta text-dim">{t("srv.worlds.hint")}</p>
        <IconButton label={t("common.open_folder")} tip variant="ghost" onClick={() => openServerFolder(server, null)}>
          <FolderOpen size={16} />
        </IconButton>
        <Button
          size="sm"
          variant="accent"
          icon={<Plus size={14} />}
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
      <div className="scroll min-h-0 flex-1">
        <div className="grid w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-5 px-6 pb-8 pt-1">
          <SettingsCard
            title={
              <>
                {t("srv.worlds")}
                {count(worlds.data?.length)}
              </>
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
                <ContextMenu key={w.name} content={<WorldItems server={server} world={w.name} kit={contextKit} />}>
                  <div className={rowCls}>
                    <Globe2 size={16} className={w.active ? "shrink-0 text-accent" : "shrink-0 text-dim"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px] text-text">{w.name}</div>
                      <div className="text-caption text-dim">{formatBytes(w.size)}</div>
                    </div>
                    {w.active && <Tag color="var(--accent)">{t("srv.worlds.active")}</Tag>}
                    <IconButton label={t("srv.backup.create")} tip variant="ghost" size="sm" onClick={() => createBackup(server, w.name)}>
                      <Archive size={14} />
                    </IconButton>
                    <MoreMenu>
                      <WorldItems server={server} world={w.name} kit={dropdownKit} />
                    </MoreMenu>
                  </div>
                </ContextMenu>
              ))
            )}
          </SettingsCard>

          <SettingsCard
            title={
              <>
                {t("srv.backups")}
                {count(backups.data?.length)}
              </>
            }
            right={
              <IconButton label={t("common.open_folder")} tip variant="ghost" size="sm" onClick={() => openServerFolder(server, "backups")}>
                <FolderOpen size={14} />
              </IconButton>
            }
          >
            {backups.isError && !backups.data ? (
              <ErrorState error={backups.error} onRetry={() => backups.refetch()} />
            ) : !backups.data ? (
              rowsSkeleton
            ) : sortedBackups.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-dim">{t("srv.backups.empty")}</div>
            ) : (
              sortedBackups.map((b) => (
                <ContextMenu key={b.name} content={<BackupItems server={server} backup={b} stopped={stopped} kit={contextKit} />}>
                  <div className={rowCls}>
                    <Archive size={15} className="shrink-0 text-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-text">
                        <span className="font-mono">{b.world}</span>
                        <span className="text-dim">
                          {" "}
                          · {formatDate(b.created)} {new Date(b.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="truncate text-caption text-dim">
                        {formatRelative(b.created)} · {formatBytes(b.size)}
                      </div>
                    </div>
                    <Tooltip content={stopped ? t("srv.backup.restore") : t("srv.backup.restore_stopped")}>
                      <span>
                        <IconButton label={t("srv.backup.restore")} variant="ghost" size="sm" disabled={!stopped} onClick={() => restoreBackup(server, b)}>
                          <ArchiveRestore size={15} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <MoreMenu>
                      <BackupItems server={server} backup={b} stopped={stopped} kit={dropdownKit} />
                    </MoreMenu>
                  </div>
                </ContextMenu>
              ))
            )}
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
