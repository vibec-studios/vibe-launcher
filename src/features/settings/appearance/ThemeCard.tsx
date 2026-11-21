import { RotateCcw, Snowflake } from "lucide-react";
import { DEFAULT_APPEARANCE, THEMES, THEME_IDS, applyTheme, effectiveAppearance, isThemeModified, isWinterSeason } from "@/lib/appearance";
import type { Appearance } from "@/lib/types";
import { Button, SettingRow, SettingsCard, Switch, Tag, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { MiniPreview } from "./MiniPreview";
import { ThemeTile } from "./ThemeTile";
import { SliderValue } from "./controls";
import type { CardProps } from "./types";

export function ThemeCard({ a, set }: CardProps) {
  const t = useT();
  const b = a.background;
  const shown = effectiveAppearance(a);
  const seasonalActive = a.seasonal && a.theme === "standard" && isWinterSeason();
  return (
    <SettingsCard
      title={t("ap.section.theme")}
      right={
        <Button
          size="sm"
          variant="subtle"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            set({
              ...DEFAULT_APPEARANCE,
              background: { ...DEFAULT_APPEARANCE.background, image: b.image, video: b.video },
              custom_themes: a.custom_themes,
            });
            toast.info(t("ap.reset.done"));
          }}
        >
          {t("ap.reset_all")}
        </Button>
      }
    >
      <div className="flex flex-wrap items-start gap-5 p-4">
        <div className="flex w-[320px] max-w-full flex-col gap-3">
          <MiniPreview a={shown} />
          <p className="text-[12.5px] leading-relaxed text-muted">{t(`ap.theme.${shown.theme}.desc`)}</p>
          <div className="flex flex-wrap items-center gap-2 empty:hidden">
            {isThemeModified(a) && !a.active_custom && (
              <Button size="sm" variant="subtle" icon={<RotateCcw size={13} />} onClick={() => set(applyTheme(a, a.theme))}>
                {t("ap.theme.reset", { name: t(`ap.theme.${a.theme}`) })}
              </Button>
            )}
            {seasonalActive && (
              <Tag className="h-6 gap-1.5 px-2 text-[12px]">
                <Snowflake size={12} /> {t("ap.seasonal.active")}
              </Tag>
            )}
          </div>
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
            {THEME_IDS.map((id) => (
              <ThemeTile
                key={id}
                id={id}
                active={a.theme === id && !a.active_custom}
                modified={a.theme === id && !a.active_custom && isThemeModified(a)}
                onClick={() => set(applyTheme(a, id))}
              />
            ))}
          </div>
        </div>
      </div>
      <SettingRow title={t("ap.seasonal")} description={t("ap.seasonal.desc")}>
        <Switch checked={a.seasonal} onChange={(seasonal) => set({ seasonal })} label={t("ap.seasonal")} />
      </SettingRow>
      <SettingRow
        title={
          <span className="flex items-center gap-2">
            {t("ap.design")}
            <Tag className="h-5 px-1.5 text-[10.5px]">Beta</Tag>
          </span>
        }
        description={t("ap.design.desc")}
      >
        <Switch checked={a.design === "v2"} onChange={(on) => set({ design: on ? "v2" : "v1" })} label={t("ap.design")} />
      </SettingRow>
    </SettingsCard>
  );
}

export function ThemeExtrasCard({ a, set }: CardProps) {
  const t = useT();
  const theme = THEMES[effectiveAppearance(a).theme];
  const setFx = (p: Partial<Appearance["effects"]>, delay?: number) => set({ effects: { ...a.effects, ...p } }, delay);
  if (theme.extras.length === 0) return null;
  return (
    <SettingsCard title={t("ap.section.extras", { name: t(`ap.theme.${theme.id}`) })}>
      {theme.extras.includes("snow") && (
        <>
          <SettingRow title={t("ap.fx.snow")} description={t("ap.fx.snow.desc")}>
            <Switch checked={a.effects.snow} onChange={(snow) => setFx({ snow })} label={t("ap.fx.snow")} />
          </SettingRow>
          <SettingRow title={t("ap.fx.snow_amount")} className={cn(!a.effects.snow && "opacity-50")}>
            <SliderValue value={a.effects.snow_amount} min={10} max={100} step={5} unit="%" disabled={!a.effects.snow} onChange={(snow_amount) => setFx({ snow_amount }, 300)} />
          </SettingRow>
          <SettingRow title={t("ap.fx.snow_settle")} description={t("ap.fx.snow_settle.desc")} className={cn(!a.effects.snow && "opacity-50")}>
            <Switch checked={a.effects.snow_settle} disabled={!a.effects.snow} onChange={(snow_settle) => setFx({ snow_settle })} label={t("ap.fx.snow_settle")} />
          </SettingRow>
        </>
      )}
      {theme.extras.includes("mascot") && (
        <SettingRow title={t("ap.fx.mascot")} description={t("ap.fx.mascot.desc")}>
          <Switch checked={a.effects.mascot} onChange={(mascot) => setFx({ mascot })} label={t("ap.fx.mascot")} />
        </SettingRow>
      )}
      {theme.extras.includes("frost") && (
        <SettingRow title={t("ap.fx.frost")} description={t("ap.fx.frost.desc")}>
          <Switch checked={a.effects.frost} onChange={(frost) => setFx({ frost })} label={t("ap.fx.frost")} />
        </SettingRow>
      )}
    </SettingsCard>
  );
}
