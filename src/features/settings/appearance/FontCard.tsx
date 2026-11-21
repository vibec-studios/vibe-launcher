import { Segmented, SettingRow, SettingsCard } from "@/components/ui";
import { useT } from "@/i18n";
import { SliderValue } from "./controls";
import type { CardProps } from "./types";

export function FontCard({ a, set }: CardProps) {
  const t = useT();
  return (
    <SettingsCard title={t("ap.section.font")}>
      <SettingRow title={t("ap.font")} description={t("ap.font.desc")}>
        <Segmented
          value={a.font}
          onChange={(font) => set({ font })}
          items={[
            { value: "inter", label: <span style={{ fontFamily: "Inter" }}>Inter</span> },
            { value: "inter_tight", label: <span style={{ fontFamily: "'Inter Tight Variable'" }}>Inter Tight</span> },
            { value: "system", label: <span style={{ fontFamily: "system-ui, 'Segoe UI'" }}>{t("ap.font.system")}</span> },
            { value: "mono", label: <span style={{ fontFamily: "'JetBrains Mono'" }}>Mono</span> },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("ap.headings")} description={t("ap.headings.desc")}>
        <Segmented
          value={a.headings}
          onChange={(headings) => set({ headings })}
          items={[
            { value: "default", label: t("ap.headings.default") },
            { value: "pixel", label: <span style={{ fontFamily: "Silkscreen", fontWeight: 400, fontSize: 12 }}>PIXEL</span> },
            { value: "pixel_all", label: t("ap.headings.pixel_all") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("ap.font_scale")} description={t("ap.font_scale.desc")}>
        <SliderValue value={a.font_scale} min={90} max={115} step={5} unit="%" onChange={(font_scale) => set({ font_scale }, 300)} />
      </SettingRow>
    </SettingsCard>
  );
}
