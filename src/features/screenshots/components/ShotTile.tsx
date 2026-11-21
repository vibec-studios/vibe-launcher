import { memo } from "react";
import { Copy, CloudUpload, Eye, FolderOpen, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Screenshot } from "@/lib/types";
import { ContextItem, ContextMenu, ContextSeparator, toast } from "@/components/ui";
import { t as tt, useT } from "@/i18n";
import { ShotThumb } from "../shots";

export const Tile = memo(function Tile({
  shot,
  instanceName,
  height,
  onOpen,
  onDelete,
  onShare,
}: {
  shot: Screenshot;
  instanceName: string;
  height: number;
  onOpen: (s: Screenshot) => void;
  onDelete: (s: Screenshot) => void;
  onShare?: (s: Screenshot) => void;
}) {
  const t = useT();
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Eye size={14} />} onSelect={() => onOpen(shot)}>
            {t("shots.view")}
          </ContextItem>
          <ContextItem icon={<Copy size={14} />} onSelect={() => copyShot(shot)}>
            {t("shots.copy")}
          </ContextItem>
          <ContextItem icon={<FolderOpen size={14} />} onSelect={() => api.screenshotOpenFolder(shot.path).catch((e) => toast.error(e))}>
            {t("shots.show_in_folder")}
          </ContextItem>
          {onShare && (
            <ContextItem icon={<CloudUpload size={14} />} onSelect={() => onShare(shot)}>
              {t("shotshare.menu")}
            </ContextItem>
          )}
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => onDelete(shot)}>
            {t("common.delete")}
          </ContextItem>
        </>
      }
    >
      <button
        onClick={() => onOpen(shot)}
        className="group relative min-w-0 flex-1 overflow-hidden rounded-card text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
        style={{ height }}
        aria-label={shot.file_name}
      >
        <ShotThumb path={shot.path} className="absolute inset-0" />
        <span className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-100 group-hover:bg-white/[.04] group-data-[state=open]:bg-white/[.04]" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-2.5 py-1.5 text-[12px] opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-data-[state=open]:opacity-100">
          <span className="truncate font-medium text-[#fff]">{instanceName}</span>
          <span className="shrink-0 text-[#fff]/70">{new Date(shot.taken_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
        </span>
      </button>
    </ContextMenu>
  );
});

async function copyShot(s: Screenshot) {
  try {
    await api.screenshotCopy(s.path);
    toast.success(tt("shots.copied"));
  } catch (e) {
    toast.error(e);
  }
}
