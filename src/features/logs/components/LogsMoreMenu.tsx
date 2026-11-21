import { Copy, Eraser, FolderOpen, MoreHorizontal, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/queries";
import type { LogLine } from "@/lib/types";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { copyText, formatLines } from "../logText";

export function LogsMoreMenu({
  id,
  runId,
  lines,
  liveLines,
  isFile,
  crash,
  reload,
}: {
  id: string;
  runId: string | undefined;
  lines: LogLine[];
  liveLines: LogLine[];
  isFile: boolean;
  crash: boolean;
  reload: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu
      trigger={
        <IconButton label={t("common.more")} tip variant="ghost" className="data-[state=open]:bg-white/[.07]">
          <MoreHorizontal size={16} />
        </IconButton>
      }
    >
      <DropdownItem icon={<Copy size={14} />} disabled={!lines.length} onSelect={() => copyText(formatLines(lines))}>
        {t("logs.copy_all")}
      </DropdownItem>
      {isFile ? (
        <DropdownItem icon={<RefreshCw size={14} />} onSelect={reload}>
          {t("logs.reload")}
        </DropdownItem>
      ) : (
        <DropdownItem icon={<Eraser size={14} />} disabled={!liveLines.length} onSelect={() => runId && useGameStore.getState().setLogs(runId, [])}>
          {t("logs.clear")}
        </DropdownItem>
      )}
      <DropdownSeparator />
      <DropdownItem icon={<FolderOpen size={14} />} onSelect={() => api.instanceOpenFolder(id, crash ? "crash-reports" : "logs").catch((e) => toast.error(e))}>
        {t("common.open_folder")}
      </DropdownItem>
    </DropdownMenu>
  );
}
