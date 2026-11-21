import { useEffect, useState } from "react";
import { CloudDownload, Settings2 } from "lucide-react";
import { Button, Checkbox, Dialog, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient, useJavaInstances } from "@/lib/queries";
import type { CloudSnapshot } from "@/lib/vibe-sdk";
import { errText } from "@/features/social/service";
import { PickList } from "./PickList";
import { hasSettings, mergeSettings, savedAt } from "./snapshot";
import { formatRelative } from "@/lib/format";

export function RestoreDialog({ open, snapshot, onClose }: { open: boolean; snapshot: CloudSnapshot | null; onClose: () => void }) {
  const t = useT();
  const { data: local = [] } = useJavaInstances();
  const names = new Set(local.map((i) => i.name.toLowerCase()));
  const [settings, setSettings] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const list = snapshot?.instances ?? [];
  const exists = (id: string, name: string) => local.some((i) => i.id === id) || names.has(name.toLowerCase());
  useEffect(() => {
    if (!open) return;
    setSettings(hasSettings(snapshot));
    setPicked(list.filter((i) => !exists(i.id, i.manifest.name)).map((i) => i.id));
  }, [open, snapshot]);

  const run = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      if (settings && hasSettings(snapshot)) {
        const next = mergeSettings(await api.settingsGet(), snapshot.settings);
        queryClient.setQueryData(qk.settings, await api.settingsSet(next));
      }
      let n = 0;
      for (const i of list.filter((x) => picked.includes(x.id))) {
        await api.vibeCloudRestoreInstance(i.manifest);
        n++;
      }
      toast.success(t("cloud.restore.done"), n ? t("cloud.restore.done_text", { n }) : undefined);
      onClose();
    } catch (e) {
      toast.error(errText(e), t("cloud.restore.failed"));
    } finally {
      setBusy(false);
    }
  };

  const when = savedAt(snapshot);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      locked={busy}
      title={t("cloud.restore.title")}
      description={when ? t("cloud.restore.desc_when", { when: formatRelative(when) }) : t("cloud.restore.desc")}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<CloudDownload size={15} />} loading={busy} disabled={!settings && !picked.length} onClick={run}>
            {t("cloud.restore.run")}
          </Button>
        </>
      }
    >
      {!snapshot ? (
        <p className="py-6 text-center text-[13px] text-muted">{t("cloud.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <label className="flex items-start gap-3 rounded-card bg-surface px-4 py-3">
            <Checkbox checked={settings} disabled={!hasSettings(snapshot)} onChange={setSettings} label={t("cloud.what.settings")} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                <Settings2 size={14} className="text-dim" />
                {t("cloud.what.settings")}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{t("cloud.restore.settings.desc")}</span>
            </span>
          </label>
          <div>
            <p className="mb-1 text-[13px] font-medium text-text">{t("cloud.what.instances")}</p>
            <p className="mb-2.5 text-[12.5px] leading-relaxed text-muted">{t("cloud.restore.instances.desc")}</p>
            {list.length ? (
              <PickList
                items={list.map((i) => ({
                  id: i.id,
                  title: i.manifest.name,
                  meta: exists(i.id, i.manifest.name) ? t("cloud.restore.exists") : `${i.manifest.mc_version} · ${t("cloud.files", { n: i.manifest.files.length })}`,
                }))}
                picked={picked}
                onChange={setPicked}
              />
            ) : (
              <p className="rounded-card bg-surface px-4 py-3 text-[12.5px] text-dim">{t("cloud.restore.no_instances")}</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
