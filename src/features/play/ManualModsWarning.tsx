import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Package } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { ContentItem } from "@/lib/types";
import { openShare } from "@/features/social/dialogs";

export function manualMods(items: ContentItem[] | undefined): ContentItem[] {
  return (items ?? []).filter((m) => m.enabled && m.source !== "modrinth" && m.source !== "curseforge");
}

export function useManualMods(instanceId: string | undefined) {
  const q = useQuery({
    queryKey: qk.content(instanceId ?? "", "mod"),
    queryFn: () => api.contentList(instanceId!, "mod"),
    enabled: !!instanceId,
    staleTime: 60_000,
  });
  return manualMods(q.data);
}

const acknowledged = new Set<string>();

export function needsManualWarning(instanceId: string, mods: ContentItem[]) {
  return mods.length > 0 && !acknowledged.has(instanceId);
}

export function ManualModsWarning({ instanceId, mods, onProceed, onClose }: { instanceId: string; mods: ContentItem[]; onProceed: () => void; onClose: () => void }) {
  const t = useT();
  const shown = mods.slice(0, 6);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mods.length === 1 ? t("playwarn.title_1") : t("playwarn.title", { n: mods.length })}
      description={t("playwarn.text")}
      size="sm"
      footer={
        <>
          <Button
            variant="subtle"
            className="mr-auto"
            onClick={() => {
              acknowledged.add(instanceId);
              onProceed();
              onClose();
            }}
          >
            {t("playwarn.anyway")}
          </Button>
          <Button
            variant="primary"
            icon={<Package size={14} />}
            autoFocus
            onClick={() => {
              onClose();
              openShare(instanceId);
            }}
          >
            {t("playwarn.as_pack")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5 px-6 pb-2">
        {shown.map((m) => (
          <div key={m.file_name} className="flex items-center gap-2 text-[12.5px] text-muted">
            <AlertTriangle size={13} className="shrink-0 text-warn" />
            <span className="truncate" title={m.file_name}>
              {m.name || m.file_name}
            </span>
          </div>
        ))}
        {mods.length > shown.length && <div className="pl-5 text-meta text-dim">{t("playwarn.more", { n: mods.length - shown.length })}</div>}
        <p className="pt-1 text-meta text-dim">{t("playwarn.hint")}</p>
      </div>
    </Dialog>
  );
}
