import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSystemInfo } from "@/lib/queries";
import { Button, Segmented, SettingRow, SettingsCard, Switch } from "@/components/ui";
import { checkForUpdate } from "@/app/UpdateNotice";
import { useExpert } from "@/lib/simple-mode";
import { useT } from "@/i18n";
import type { TabProps } from "../types";

export function UpdatesTab({ s, update }: TabProps) {
  const t = useT();
  const channel = useExpert("update-channel");
  const sys = useSystemInfo();
  const [checking, setChecking] = useState(false);
  const checkUpdates = async () => {
    setChecking(true);
    try {
      await checkForUpdate(true);
    } finally {
      setChecking(false);
    }
  };
  return (
    <SettingsCard title={t("settings.section.updates")} right={sys.data && <span className="text-caption font-semibold tabular-nums text-dim">v{sys.data.version}</span>}>
      {channel && (
      <SettingRow title={t("settings.channel")} description={s.update_channel === "dev" ? t("settings.channel.dev.desc") : t("settings.channel.release.desc")}>
        <Segmented
          value={s.update_channel}
          onChange={(update_channel) => update({ update_channel })}
          items={[
            { value: "release", label: t("settings.channel.release") },
            { value: "dev", label: t("settings.channel.dev") },
          ]}
        />
      </SettingRow>
      )}
      <SettingRow title={t("settings.check_updates")} description={t("settings.check_updates.desc")}>
        <Switch checked={s.check_updates} onChange={(check_updates) => update({ check_updates })} label={t("settings.check_updates")} />
      </SettingRow>
      <SettingRow title={t("settings.update.manual")} description={t("settings.update.manual.desc")}>
        <Button size="sm" icon={<RefreshCw size={13} />} loading={checking} onClick={checkUpdates}>
          {t("settings.update.check_now")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}
