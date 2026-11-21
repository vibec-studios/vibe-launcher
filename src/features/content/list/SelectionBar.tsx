import { Power, PowerOff, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentItem, ContentKind } from "@/lib/types";
import { SelectionOrgButton } from "../organize/SelectionOrgButton";
import { BarButton } from "./parts";

interface Props {
  id: string;
  count: number;
  selItems: ContentItem[];
  selUpdates: ContentItem[];
  updatesRunning: boolean;
  setEnabled: (items: ContentItem[], enabled: boolean) => void;
  update: (items: ContentItem[]) => void;
  remove: (items: ContentItem[]) => void;
  clear: () => void;
}

export function SelectionBar({ id, count, selItems, selUpdates, updatesRunning, setEnabled, update, remove, clear }: Props) {
  const t = useT();
  return (
    <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <div className="flex items-center gap-0.5 rounded-card bg-overlay p-1 pl-3 shadow-e2 animate-slide-up">
        <span className="mr-2 text-[13px] font-semibold text-text">{t("content.selected", { n: count })}</span>
        <BarButton icon={<Power size={14} />} onClick={() => setEnabled(selItems, true)} disabled={!selItems.some((c) => !c.enabled)}>
          {t("content.menu.enable")}
        </BarButton>
        <BarButton icon={<PowerOff size={14} />} onClick={() => setEnabled(selItems, false)} disabled={!selItems.some((c) => c.enabled)}>
          {t("content.menu.disable")}
        </BarButton>
        <BarButton icon={<RefreshCw size={14} />} onClick={() => update(selUpdates)} disabled={!selUpdates.length || updatesRunning}>
          {t("common.update")}
          {selUpdates.length > 0 && ` (${selUpdates.length})`}
        </BarButton>
        <SelectionOrgButton instanceId={id} items={selItems} />
        <BarButton icon={<Trash2 size={14} />} onClick={() => remove(selItems)} danger>
          {t("common.remove")}
        </BarButton>
        <span className="mx-1 h-5 w-px bg-line2" />
        <IconButton label={t("content.clear_selection")} tip variant="ghost" size="sm" onClick={clear}>
          <X size={14} />
        </IconButton>
      </div>
    </div>
  );
}

export function DropOverlay({ dropKinds, zipKind, name }: { dropKinds: ContentKind[]; zipKind: ContentKind; name: string }) {
  const t = useT();
  return (
    <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2.5 border-2 border-dashed border-accent bg-black/80 animate-fade-in">
      <Upload size={26} className="text-accent" />
      <div className="text-[16px] font-semibold text-text">{t("ipage.ct.drop")}</div>
      <div className="text-[13px] text-muted">
        {dropKinds.map((k) => t(`content.kind.${k === "resourcepack" || k === "shader" ? zipKind : k}`)).filter((x, i, a) => a.indexOf(x) === i).join(" · ")} · {name}
      </div>
    </div>
  );
}
