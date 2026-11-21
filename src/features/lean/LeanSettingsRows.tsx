import { SettingRow, Switch } from "@/components/ui";
import { useT } from "@/i18n";
import type { TabProps } from "@/features/settings/types";

const DEFAULTS = { enabled: true, reopen: true };

export function LeanSettingsRows({ s, update }: TabProps) {
  const t = useT();
  const lean = { ...DEFAULTS, ...s.lean };
  return (
    <>
      <SettingRow title={t("lean.enabled")} description={t("lean.enabled.desc")}>
        <Switch checked={lean.enabled} onChange={(enabled) => update({ lean: { ...lean, enabled } })} label={t("lean.enabled")} />
      </SettingRow>
      {lean.enabled && (
        <SettingRow title={t("lean.reopen")} description={t("lean.reopen.desc")}>
          <Switch checked={lean.reopen} onChange={(reopen) => update({ lean: { ...lean, reopen } })} label={t("lean.reopen")} />
        </SettingRow>
      )}
    </>
  );
}
