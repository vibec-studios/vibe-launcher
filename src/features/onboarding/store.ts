// Onboarding (erster Start) und Einführungs-Bubbles (Simple-Modus): manuell startbar aus den Einstellungen.
// Die Einführung läuft über das Tour-System in src/features/help/tour.
import { create } from "zustand";
import { startTour as startHelpTour } from "@/features/help/tour/store";

interface OnboardingState {
  /** Onboarding manuell geöffnet („Einrichtung erneut starten“) */
  open: boolean;
}

export const useOnboarding = create<OnboardingState>(() => ({ open: false }));

export function restartOnboarding() {
  useOnboarding.setState({ open: true });
}

export function startTour() {
  startHelpTour("intro");
}
