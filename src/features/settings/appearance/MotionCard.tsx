import type { Settings } from "@/lib/types";
import { Segmented, SettingRow, SettingsCard, Switch, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Update } from "../types";
import type { CardProps } from "./types";

export function MotionCard({ a, set, s, update }: CardProps & { s: Settings; update: Update }) {
  const t = useT();
  const motion = s.reduce_motion ? "reduced" : a.motion;
  return (
    <SettingsCard title={t("ap.section.motion")}>
      <SettingRow title={t("ap.motion")} description={t(`ap.motion.${motion}.desc`)}>
        <Segmented
          value={motion}
          onChange={(v) => {
            const reduce_motion = v === "reduced";
            document.documentElement.dataset.reduceMotion = String(reduce_motion);
            update({ reduce_motion, appearance: { ...a, motion: v === "more" ? "more" : v === "normal" ? "normal" : a.motion } });
          }}
          items={(["reduced", "normal", "more"] as const).map((v) => ({ value: v, label: t(`ap.motion.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.nav_animations")} description={t("ap.nav_animations.desc")} className={cn(motion === "reduced" && "opacity-50")}>
        <Switch checked={a.nav_animations} disabled={motion === "reduced"} onChange={(nav_animations) => set({ nav_animations })} label={t("ap.nav_animations")} />
      </SettingRow>
    </SettingsCard>
  );
}
