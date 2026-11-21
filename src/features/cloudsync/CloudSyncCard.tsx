import { useState } from "react";
import { CloudDownload, CloudUpload, Trash2 } from "lucide-react";
import { Button, SettingRow, SettingsCard, Skeleton, Switch, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import { errText, useSocial } from "@/features/social/service";
import { BackupDialog } from "./BackupDialog";
import { RestoreDialog } from "./RestoreDialog";
import { CloudConflict, hasSettings, pushSnapshot, savedAt, useCloudEnabled, useCloudState } from "./snapshot";

export function CloudSyncCard() {
  const t = useT();
  const linked = useSocial((s) => s.linked);
  const [on, setOn] = useCloudEnabled();
  const q = useCloudState(on);
  const [backup, setBackup] = useState(false);
  const [restore, setRestore] = useState(false);
  const snap = q.data?.snapshot ?? null;
  const when = savedAt(snap);

  const wipe = async () => {
    if (!q.data) return;
    const ok = await confirm({ title: t("cloud.wipe.title"), text: t("cloud.wipe.text"), confirmLabel: t("cloud.wipe"), danger: true });
    if (!ok) return;
    try {
      await pushSnapshot(q.data.revision, null);
      toast.success(t("cloud.wipe.done"));
    } catch (e) {
      toast.error(e instanceof CloudConflict ? t("cloud.conflict.again") : errText(e));
    }
  };

  return (
    <SettingsCard title={t("cloud.title")}>
      <SettingRow title={t("cloud.optin")} description={t("cloud.optin.desc")}>
        <Switch checked={on} disabled={!linked} onChange={setOn} label={t("cloud.optin")} />
      </SettingRow>
      {on && linked && (
        <>
          <SettingRow
            title={t("cloud.state")}
            description={
              !q.data ? (
                q.isError ? (
                  errText(q.error)
                ) : (
                  <Skeleton className="mt-1 h-3.5 w-52" />
                )
              ) : snap ? (
                <>
                  {when ? t("cloud.saved_at", { when: formatRelative(when) }) : t("cloud.saved_unknown")} · {t("cloud.count", { n: snap.instances.length })}
                  {hasSettings(snap) ? ` · ${t("cloud.with_settings")}` : ""}
                </>
              ) : (
                t("cloud.empty")
              )
            }
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" icon={<CloudDownload size={13} />} disabled={!snap} onClick={() => setRestore(true)}>
                {t("cloud.restore")}
              </Button>
              <Button size="sm" variant="primary" icon={<CloudUpload size={13} />} disabled={!q.data} onClick={() => setBackup(true)}>
                {t("cloud.backup")}
              </Button>
            </div>
          </SettingRow>
          {snap && (
            <SettingRow title={t("cloud.wipe")} description={t("cloud.wipe.desc")}>
              <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={wipe}>
                {t("cloud.wipe")}
              </Button>
            </SettingRow>
          )}
        </>
      )}
      <BackupDialog open={backup} onClose={() => setBackup(false)} remote={q.data} />
      <RestoreDialog open={restore} snapshot={snap} onClose={() => setRestore(false)} />
    </SettingsCard>
  );
}
