import { memo } from "react";
import { History, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance, SnapshotInfo } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { useT } from "@/i18n";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, confirm, toast } from "@/components/ui";
import { runBackupTask } from "../worldActions";
import { useScopeList } from "../FixBackupPicker";
import { dateTime } from "../utils";
import { AutoTag, PartialTag } from "./parts";

export const SnapshotRow = memo(function SnapshotRow({ instance, snap, busy }: { instance: Instance; snap: SnapshotInfo; busy: boolean }) {
  const t = useT();
  const scopeList = useScopeList();
  const restore = async () => {
    const ok = await confirm({
      title: t("backups.snapshot.restore_title", { name: snap.name }),
      text: snap.scopes ? `${t("backups.snapshot.restore_text")} ${t("backups.partial_hint", { areas: scopeList(snap.scopes) })}` : t("backups.snapshot.restore_text"),
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
          {snap.scopes && <PartialTag scopes={snap.scopes} />}
        </div>
        <div className="truncate text-[12px] leading-tight text-dim">
          {dateTime(snap.created)} · {formatRelative(snap.created)} · {t("backups.snapshot.files", { n: snap.file_count })} · {formatBytes(snap.size)}
          {snap.scopes && <> · {scopeList(snap.scopes)}</>}
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
