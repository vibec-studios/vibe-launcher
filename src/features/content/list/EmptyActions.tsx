import { Activity, FilePlus2, FolderOpen, Gauge, Plus, Video } from "lucide-react";
import { Button, DropdownMenu } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentKind, QuickMod } from "@/lib/types";
import { RefreshButton } from "@/features/instances/RefreshButton";
import { AddFilesItems } from "./AddFiles";

interface Props {
  id: string;
  kinds: ContentKind[];
  vanilla: boolean;
  addKind: ContentKind;
  toDiscover: () => void;
  openFolder: (kind: ContentKind) => void;
  openPerf: () => void;
  openQuickMod: (tool: QuickMod) => void;
}

export function EmptyActions({ id, kinds, vanilla, addKind, toDiscover, openFolder, openPerf, openQuickMod }: Props) {
  const t = useT();
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="accent" data-tour="content-add" icon={<Plus size={15} />} onClick={toDiscover}>
        {t("content.add")}
      </Button>
      <DropdownMenu
        trigger={
          <Button variant="ghost" data-tour="content-add-files" icon={<FilePlus2 size={15} />}>
            {t("content.add_files_short")}
          </Button>
        }
      >
        <AddFilesItems id={id} kinds={kinds} />
      </DropdownMenu>
      {!vanilla && (
        <Button variant="ghost" icon={<Gauge size={15} />} onClick={openPerf}>
          {t("perf.title")}
        </Button>
      )}
      <Button variant="ghost" icon={<Video size={15} />} onClick={() => openQuickMod("replaymod")}>
        {t("quick_mod.replaymod.title")}
      </Button>
      <Button variant="ghost" icon={<Activity size={15} />} onClick={() => openQuickMod("spark")}>
        {t("quick_mod.spark.title")}
      </Button>
      <Button variant="subtle" icon={<FolderOpen size={15} />} onClick={() => openFolder(addKind)}>
        {t("common.open_folder")}
      </Button>
      {/* Dateien von Hand in den Ordner gelegt? -> neu einlesen */}
      <RefreshButton instanceId={id} variant="empty" />
    </div>
  );
}
