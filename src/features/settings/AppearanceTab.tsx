// Tab „Darstellung“: Theme (Voreinstellung mit Extras), Farbe, Schrift, Form & Dichte, Seitenleiste, Bibliothek,
// Bewegung, Hintergrund. Jede Änderung wirkt sofort (Vorschau über useAppearanceDraft) und speichert automatisch.
import { useEffect } from "react";
import type { Appearance, Settings } from "@/lib/types";
import { normalizeAppearance, useAppearanceDraft } from "@/lib/appearance";
import { SettingRow, SettingsCard, Switch } from "@/components/ui";
import { useT } from "@/i18n";
import { CustomThemesCard } from "./appearance/CustomThemesCard";
import { AppIconCard } from "./appearance/AppIconCard";
import { BackgroundCard } from "./appearance/BackgroundCard";
import { ColorCard } from "./appearance/ColorCard";
import { FontCard } from "./appearance/FontCard";
import { LibraryCard } from "./appearance/LibraryCard";
import { MotionCard } from "./appearance/MotionCard";
import { ShapeCard } from "./appearance/ShapeCard";
import { SidebarCard } from "./appearance/SidebarCard";
import { ThemeCard, ThemeExtrasCard } from "./appearance/ThemeCard";
import type { Update } from "./types";

export function AppearanceTab({ s, update }: { s: Settings; update: Update }) {
  const t = useT();
  // Simple-Modus: nur die Basics (Theme, Akzentfarbe, Animationen)
  const a = normalizeAppearance(s.appearance);

  // Vorschau: der ganze Launcher zeigt den Entwurf, solange dieser Tab offen ist
  const key = JSON.stringify(a);
  useEffect(() => {
    useAppearanceDraft.setState({ draft: a });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => useAppearanceDraft.setState({ draft: null }), []);

  const set = (p: Partial<Appearance>, delay?: number) => update({ appearance: { ...a, ...p } }, delay);

  return (
    <>
      <ThemeCard a={a} set={set} />
      <CustomThemesCard a={a} set={(p) => set(p)} />
      <ThemeExtrasCard a={a} set={set} />
      <ColorCard a={a} set={set} />
      <FontCard a={a} set={set} />
      <ShapeCard a={a} set={set} />
      <SidebarCard a={a} set={set} />
      <LibraryCard a={a} set={set} />
      <MotionCard a={a} set={set} s={s} update={update} />
      <BackgroundCard a={a} set={set} />
      <AppIconCard a={a} set={set} />
      <SettingsCard title={t("ap.section.more")}>
        <SettingRow title={t("settings.minecraftcapes")} description={t("settings.minecraftcapes.desc")}>
          <Switch checked={s.minecraftcapes} onChange={(minecraftcapes) => update({ minecraftcapes })} label={t("settings.minecraftcapes")} />
        </SettingRow>
      </SettingsCard>
    </>
  );
}
