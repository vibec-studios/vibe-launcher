import { memo } from "react";
import { MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance, WorldBackup } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { useT } from "@/i18n";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, confirm, toast } from "@/components/ui";
import { runBackupTask } from "../worldActions";
import { dateTime } from "../utils";
import { AutoTag } from "./parts";

export const WorldBackupRow = memo(function WorldBackupRow({ instance, b, busy }: { instance: Instance; b: WorldBackup; busy: boolean }) {
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
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[13px] text-text">
          {dateTime(b.created)} <span className="text-dim">· {formatRelative(b.created)} · {formatBytes(b.size)}</span>
        </span>
        {b.auto && <AutoTag />}
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
