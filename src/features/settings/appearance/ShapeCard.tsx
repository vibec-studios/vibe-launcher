import { Segmented, SettingRow, SettingsCard, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { SliderValue } from "./controls";
import type { CardProps } from "./types";

export function ShapeCard({ a, set }: CardProps) {
  const t = useT();
  return (
    <SettingsCard title={t("ap.section.shape")}>
      <SettingRow
        title={t("ap.radius")}
        description={a.cards === "pixel" ? t("ap.radius.pixel_hint") : t("ap.radius.desc")}
        className={cn(a.cards === "pixel" && "opacity-50")}
      >
        <Segmented
          value={a.radius}
          onChange={(radius) => set({ radius })}
          items={(["square", "slight", "round", "custom"] as const).map((v) => ({
            value: v,
            label: (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 border-[1.5px] border-current opacity-80"
                  style={{ borderRadius: v === "square" ? 0 : v === "slight" ? 2 : v === "round" ? 4.5 : Math.min(6, a.radius_px / 3) }}
                />
                {t(`ap.radius.${v}`)}
              </span>
            ),
          }))}
        />
      </SettingRow>
      {a.radius === "custom" && a.cards !== "pixel" && (
        <SettingRow title={t("ap.radius_px")} description={t("ap.radius_px.desc")}>
          <SliderValue value={a.radius_px} min={0} max={24} step={1} unit="px" onChange={(radius_px) => set({ radius_px }, 200)} />
        </SettingRow>
      )}
      <SettingRow title={t("ap.cards")} description={t("ap.cards.desc")}>
        <Segmented
          value={a.cards}
          onChange={(cards) => set({ cards })}
          items={(["flat", "outlined", "raised", "pixel"] as const).map((v) => ({
            value: v,
            label: (
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-3 w-3.5 bg-white/15",
                    v === "outlined" && "shadow-[inset_0_0_0_1.5px_currentColor]",
                    v === "raised" && "shadow-[0_2px_4px_rgb(0_0_0/0.5)]",
                    v === "pixel" && "shadow-[inset_0_0_0_2px_currentColor,0_2px_0_currentColor]",
                  )}
                />
                {t(`ap.cards.${v}`)}
              </span>
            ),
          }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.density")} description={t("ap.density.desc")}>
        <Segmented
          value={a.density}
          onChange={(density) => set({ density })}
          items={(["compact", "normal"] as const).map((v) => ({ value: v, label: t(`ap.density.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.scale")} description={t("ap.scale.desc")}>
        <SliderValue value={a.ui_scale} min={80} max={130} step={5} unit="%" onChange={(ui_scale) => set({ ui_scale }, 350)} />
      </SettingRow>
    </SettingsCard>
  );
}
