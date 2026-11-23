// Wendet die Darstellung (gespeichert oder Vorschau aus dem Einstellungs-Tab) an und zeichnet Hintergrund und
// Theme-Extras (Winter: Schneefall).
import { useEffect } from "react";
import { useSettings } from "@/lib/queries";
import { applyAppearance, effectiveAppearance, normalizeAppearance, themeExtra, useAppearanceDraft } from "@/lib/appearance";
import { Backdrop } from "./Backdrop";
import { Snowfall } from "./Snowfall";
import { ThemeHost } from "@/features/themes/ThemeHost";

export function AppearanceHost() {
  const saved = useSettings().data?.appearance;
  const draft = useAppearanceDraft((s) => s.draft);
  const a = normalizeAppearance(draft ?? saved);
  const key = JSON.stringify(a);
  useEffect(() => {
    // Erst anwenden, wenn die Einstellungen geladen sind – vorher gilt der Cache aus main.tsx
    if (draft || saved) applyAppearance(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const shown = effectiveAppearance(a);
  return (
    <>
      <Backdrop appearance={shown} />
      <ThemeHost />
      {themeExtra(shown, "snow") && <Snowfall amount={shown.effects.snow_amount} settle={shown.effects.snow_settle} />}
    </>
  );
}
