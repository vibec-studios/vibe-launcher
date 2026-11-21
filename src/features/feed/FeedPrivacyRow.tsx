import { SettingRow } from "@/components/ui";
import { useT } from "@/i18n";
import { useSocial } from "@/features/social/service";
import { FeedSwitch } from "./FeedCard";

export function FeedPrivacyRow() {
  const t = useT();
  const linked = useSocial((s) => s.linked);
  return (
    <SettingRow title={t("feed.switch")} description={linked ? t("feed.privacy.desc") : t("feed.privacy.login")}>
      {linked ? <FeedSwitch /> : undefined}
    </SettingRow>
  );
}
