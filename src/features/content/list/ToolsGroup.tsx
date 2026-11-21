import { Activity, FolderOpen, Gauge, RefreshCw, SlidersHorizontal, Video } from "lucide-react";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentItem, ContentKind, QuickMod, TaskInfo } from "@/lib/types";
import { kindFolder } from "@/components/content/util";
import { RefreshButton } from "@/features/instances/RefreshButton";
import { ModSetsMenu } from "../ModSetsMenu";
import { GroupsMenu } from "../organize/GroupsMenu";
import { AddFilesItems } from "./AddFiles";

interface Props {
  id: string;
  kinds: ContentKind[];
  vanilla: boolean;
  simple: boolean;
  all: ContentItem[];
  selItems: ContentItem[];
  updatesAll: number;
  updTask: TaskInfo | undefined;
  updateAll: () => void;
  setEnabled: (items: ContentItem[], enabled: boolean) => void;
  openFolder: (kind: ContentKind) => void;
  openPerf: () => void;
  openQuickMod: (tool: QuickMod) => void;
}

export function ToolsGroup({ id, kinds, vanilla, simple, all, selItems, updatesAll, updTask, updateAll, setEnabled, openFolder, openPerf, openQuickMod }: Props) {
  const t = useT();
  const updatesRunning = updTask?.status === "running";
  return (
    // Rechte Gruppe bleibt zusammen und rechtsbündig, auch wenn die Zeile umbricht
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      {updatesAll > 0 && (
        <Button
          size="sm"
          variant="subtle"
          data-tour="content-update"
          className="px-2.5 text-accent hover:bg-accent hover:text-[var(--on-accent)]"
          icon={updatesRunning ? <Spinner size={12} /> : <RefreshCw size={14} />}
          disabled={updatesRunning}
          onClick={updateAll}
        >
          {updatesRunning && updTask?.progress != null ? `${Math.round(updTask.progress * 100)}%` : t(simple ? "ipage.ct.update_all" : "ipage.update_n", { n: updatesAll })}
        </Button>
      )}
      {/* Neu prüfen: Ordner neu einlesen, Updates ohne Cache, Probleme (auch Loader) – auch per F5. Behält seinen Text;
          Mod-Sets/Werkzeuge zeigen ihren erst ab 1240px, damit die Leiste bei 1280er-Fenstern einzeilig bleibt */}
      <RefreshButton instanceId={id} />
      <GroupsMenu instanceId={id} items={all} selected={selItems} setEnabled={setEnabled} labelClassName="hidden @min-[1240px]:inline" />
      <ModSetsMenu instanceId={id} labelClassName="hidden @min-[1240px]:inline" />
      <DropdownMenu
        trigger={
          <Button size="sm" variant="subtle" icon={<SlidersHorizontal size={14} />} title={t("ipage.tools")} className="px-2.5 data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
            <span className="hidden @min-[1240px]:inline">{t("ipage.tools")}</span>
          </Button>
        }
      >
        {!vanilla && (
          <DropdownItem icon={<Gauge size={14} />} onSelect={openPerf}>
            {t("perf.title")} …
          </DropdownItem>
        )}
        <DropdownItem icon={<Video size={14} />} onSelect={() => openQuickMod("replaymod")}>
          {t("quick_mod.replaymod.title")}
        </DropdownItem>
        <DropdownItem icon={<Activity size={14} />} onSelect={() => openQuickMod("spark")}>
          {t("quick_mod.spark.title")}
        </DropdownItem>
        <DropdownSeparator />
        <AddFilesItems id={id} kinds={kinds} />
        <DropdownSeparator />
        {kinds.map((k) => (
          <DropdownItem key={k} icon={<FolderOpen size={14} />} onSelect={() => openFolder(k)}>
            {t("ipage.ct.open_folder", { folder: kindFolder[k] })}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
