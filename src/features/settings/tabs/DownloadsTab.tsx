import { useSystemInfo } from "@/lib/queries";
import { NumberInput, SettingRow, SettingsCard, Slider } from "@/components/ui";
import { useT } from "@/i18n";
import { StoresCard } from "../StoresCard";
import { SecretInput } from "../components/SecretInput";
import type { TabProps } from "../types";

export function DownloadsTab({ s, update }: TabProps) {
  const t = useT();
  const sys = useSystemInfo();
  return (
    <>
      <SettingsCard title={t("settings.section.downloads")}>
        <SettingRow title={t("settings.concurrent")} description={t("settings.concurrent.desc")}>
          <div className="flex w-[300px] max-w-full items-center gap-4">
            <Slider value={s.concurrent_downloads} min={1} max={64} onChange={(v) => update({ concurrent_downloads: v }, 400)} />
            <NumberInput
              className="w-[80px] shrink-0"
              value={s.concurrent_downloads}
              min={1}
              max={64}
              onChange={(v) => v !== null && update({ concurrent_downloads: v })}
              aria-label={t("settings.concurrent")}
            />
          </div>
        </SettingRow>
        <SettingRow
          title="CurseForge API-Key"
          description={
            <>
              {t("settings.cf.desc")}{" "}
              <span className={sys.data?.curseforge_available ? "text-ok" : "text-warn"}>
                {sys.data?.curseforge_available ? t("settings.status.active") : t("settings.status.inactive")}
              </span>
            </>
          }
          stacked
        >
          <SecretInput value={s.curseforge_api_key ?? ""} placeholder={t("settings.cf.placeholder")} onChange={(v) => update({ curseforge_api_key: v.trim() || null }, 700)} />
        </SettingRow>
      </SettingsCard>

      <StoresCard id="set-stores" />
    </>
  );
}
