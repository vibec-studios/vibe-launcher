import { useEffect, useState } from "react";
import { CloudUpload, Settings2 } from "lucide-react";
import { Button, Checkbox, Dialog, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useJavaInstances } from "@/lib/queries";
import type { CloudSettings, CloudSnapshot } from "@/lib/vibe-sdk";
import { errText } from "@/features/social/service";
import { PickList } from "./PickList";
import { CloudConflict, buildSnapshot, pushSnapshot } from "./snapshot";
import { ConflictDialog } from "./ConflictDialog";

export function BackupDialog({ open, onClose, remote }: { open: boolean; onClose: () => void; remote: CloudSettings | undefined }) {
  const t = useT();
  const { data: instances = [] } = useJavaInstances();
  const [settings, setSettings] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ remote: CloudSettings; mine: CloudSnapshot } | null>(null);
  useEffect(() => {
    if (open) setPicked(instances.slice(0, 100).map((i) => i.id));
  }, [open, instances.length]);

  const run = async () => {
    setBusy(true);
    let snap: CloudSnapshot | null = null;
    try {
      snap = await buildSnapshot({ settings, instanceIds: picked }, remote?.snapshot ?? null);
      await pushSnapshot(remote?.revision ?? 0, snap);
      toast.success(t("cloud.backup.done"), t("cloud.backup.done_text", { n: snap.instances.length }));
      onClose();
    } catch (e) {
      if (e instanceof CloudConflict && snap) setConflict({ remote: e.remote, mine: snap });
      else toast.error(errText(e), t("cloud.backup.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !conflict}
        onOpenChange={(o) => !o && onClose()}
        size="lg"
        locked={busy}
        title={t("cloud.backup.title")}
        description={t("cloud.backup.desc")}
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={<CloudUpload size={15} />} loading={busy} disabled={!settings && !picked.length} onClick={run}>
              {busy ? t("cloud.backup.running") : t("cloud.backup.run")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <label className="flex items-start gap-3 rounded-card bg-surface px-4 py-3">
            <Checkbox checked={settings} onChange={setSettings} label={t("cloud.what.settings")} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                <Settings2 size={14} className="text-dim" />
                {t("cloud.what.settings")}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{t("cloud.what.settings.desc")}</span>
            </span>
          </label>
          <div>
            <p className="mb-1 text-[13px] font-medium text-text">{t("cloud.what.instances")}</p>
            <p className="mb-2.5 text-[12.5px] leading-relaxed text-muted">{t("cloud.what.instances.desc")}</p>
            {instances.length ? (
              <PickList
                items={instances.map((i) => ({ id: i.id, title: i.name, meta: `${i.mc_version}${i.loader.kind !== "vanilla" ? ` · ${i.loader.kind}` : ""}` }))}
                picked={picked}
                onChange={(ids) => setPicked(ids.slice(0, 100))}
              />
            ) : (
              <p className="rounded-card bg-surface px-4 py-3 text-[12.5px] text-dim">{t("cloud.what.no_instances")}</p>
            )}
          </div>
          {remote?.snapshot && <p className="text-[12px] text-warn">{t("cloud.backup.replace")}</p>}
        </div>
      </Dialog>
      <ConflictDialog
        conflict={conflict}
        onClose={() => {
          setConflict(null);
          onClose();
        }}
      />
    </>
  );
}
