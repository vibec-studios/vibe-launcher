import { Button, SettingRow, SettingsCard } from "@/components/ui";
import { openSettings } from "@/features/settings/store";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { closeInstanceSettings } from "../store";
import type { TabProps } from "./types";

// ------------------------------------------------------------------ Vibe

export function VibeTab(_: TabProps) {
  const t = useT();
  const vibe = useVibe();
  return (
    <>
      <SettingsCard title={t("isd.section.vibe_services")}>
        <SettingRow
          title={t("isd.vibe.relay")}
          description={
            <>
              {t("isd.vibe.relay.desc")}{" "}
              <span className={vibe.hosting ? "text-ok" : "text-warn"}>{vibe.hosting ? t("isd.vibe.relay.on") : t("isd.vibe.relay.off")}</span>
            </>
          }
        >
          <Button
            size="sm"
            onClick={() => {
              closeInstanceSettings();
              openSettings("vibe");
            }}
          >
            {t("isd.vibe.settings")}
          </Button>
        </SettingRow>
      </SettingsCard>
    </>
  );
}
