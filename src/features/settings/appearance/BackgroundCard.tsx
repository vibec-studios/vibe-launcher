import type { ReactNode } from "react";
import { Boxes, Film, Rainbow, Sparkles, Waves } from "lucide-react";
import { GRADIENTS } from "@/lib/appearance";
import type { Appearance, BackgroundAnimated, BackgroundGradient, BackgroundKind } from "@/lib/types";
import { Segmented, SettingRow, SettingsCard, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { GradientEditor, SolidColorEditor } from "./BackgroundEditors";
import { FilePick } from "./FilePick";
import { PresetTile, SliderValue } from "./controls";
import type { CardProps } from "./types";

const GRADIENT_KEYS: Exclude<BackgroundGradient, "custom">[] = ["pixel", "accent", "dusk", "ocean", "ember", "forest"];
const ANIMATED: { key: BackgroundAnimated; icon: ReactNode }[] = [
  { key: "aurora", icon: <Rainbow size={18} /> },
  { key: "particles", icon: <Sparkles size={18} /> },
  { key: "waves", icon: <Waves size={18} /> },
  { key: "blocks", icon: <Boxes size={18} /> },
  { key: "custom", icon: <Film size={18} /> },
];

export function BackgroundCard({ a, set }: CardProps) {
  const t = useT();
  const b = a.background;
  const setBg = (p: Partial<Appearance["background"]>, delay?: number) => set({ background: { ...b, ...p } }, delay);
  return (
    <SettingsCard title={t("ap.section.background")}>
      <SettingRow title={t("ap.bg.kind")} description={`${t("ap.bg.kind.desc")} ${t("ap.paused_hint")}`} stacked>
        <div className="flex flex-col gap-3">
          <Segmented<BackgroundKind>
            value={b.kind}
            onChange={(kind) => setBg({ kind })}
            items={(["none", "color", "gradient", "image", "animated"] as const).map((v) => ({ value: v, label: t(`ap.bg.${v}`) }))}
          />
          {b.kind === "color" && <SolidColorEditor b={b} setBg={setBg} />}
          {b.kind === "gradient" && (
            <div className="flex flex-wrap gap-2">
              {GRADIENT_KEYS.map((g) => (
                <PresetTile key={g} label={t(`ap.grad.${g}`)} active={b.gradient === g} onClick={() => setBg({ gradient: g })}>
                  <span className="absolute inset-0" style={{ background: GRADIENTS[g](a.accent), imageRendering: g === "pixel" ? "pixelated" : undefined }} />
                </PresetTile>
              ))}
              <PresetTile label={t("ap.grad.custom")} active={b.gradient === "custom"} onClick={() => setBg({ gradient: "custom" })}>
                <span className="absolute inset-0" style={{ background: `linear-gradient(${b.gradient_angle}deg, ${b.gradient_from}, ${b.gradient_to})` }} />
              </PresetTile>
            </div>
          )}
          {b.kind === "gradient" && b.gradient === "custom" && <GradientEditor b={b} setBg={setBg} />}
          {b.kind === "image" && (
            <FilePick slot="image" path={b.image} onPicked={(image) => setBg({ image, kind: "image" })} onRemove={() => setBg({ image: null, kind: "none" })} />
          )}
          {b.kind === "animated" && (
            <>
              <div className="flex flex-wrap gap-2">
                {ANIMATED.map(({ key, icon }) => (
                  <PresetTile key={key} label={t(`ap.anim.${key}`)} active={b.animated === key} onClick={() => setBg({ animated: key })}>
                    <span className="absolute inset-0 grid place-items-center bg-white/[.05] text-muted">{icon}</span>
                  </PresetTile>
                ))}
              </div>
              {b.animated === "custom" && (
                <FilePick slot="video" path={b.video} onPicked={(video) => setBg({ video })} onRemove={() => setBg({ video: null, animated: "aurora" })} />
              )}
            </>
          )}
        </div>
      </SettingRow>
      <SettingRow title={t("ap.dim")} description={t("ap.dim.desc")} className={cn(b.kind === "none" && "opacity-50")}>
        <SliderValue value={b.dim} min={0} max={90} step={5} unit="%" disabled={b.kind === "none"} onChange={(dim) => setBg({ dim }, 300)} />
      </SettingRow>
      <SettingRow title={t("ap.blur")} description={t("ap.blur.desc")} className={cn(b.kind === "none" && "opacity-50")}>
        <SliderValue value={b.blur} min={0} max={40} step={2} unit="px" disabled={b.kind === "none"} onChange={(blur) => setBg({ blur }, 300)} />
      </SettingRow>
      <SettingRow
        title={t("ap.glass")}
        description={b.kind === "none" ? t("ap.glass.needs_bg") : a.cards === "pixel" ? t("ap.glass.pixel_hint") : t("ap.glass.desc")}
        className={cn(b.kind === "none" && "opacity-50")}
      >
        <SliderValue value={a.glass} min={0} max={100} step={5} unit="%" disabled={b.kind === "none"} onChange={(glass) => set({ glass }, 250)} />
      </SettingRow>
    </SettingsCard>
  );
}
