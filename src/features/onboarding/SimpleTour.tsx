// Kurze Einführung im Simple-Modus: startet einmal nach dem Onboarding bzw. beim ersten Wechsel in Simple.
// Die Bubbles selbst zeichnet das Tour-System (src/features/help/tour, Tour „intro“); erneut startbar in den
// Einstellungen und unter Hilfe & Anleitungen.
import { useEffect } from "react";
import { useInstances, useSettings } from "@/lib/queries";
import { patchSettings } from "@/lib/mode";
import { autoStartTour } from "@/features/help/tour/store";
import { useOnboarding } from "./store";

export function SimpleTour() {
  const s = useSettings().data;
  const onboarding = useOnboarding((x) => x.open);
  const games = useInstances().data;
  const auto = !!s && s.onboarding_done && s.ui_mode === "simple" && !s.simple_tour_done && !onboarding && !!games;
  useEffect(() => {
    if (!auto) return;
    autoStartTour("intro");
    void patchSettings({ simple_tour_done: true }).catch(() => {});
  }, [auto]);
  return null;
}
