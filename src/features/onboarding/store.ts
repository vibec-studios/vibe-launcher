// Onboarding (erster Start) und Einführungs-Bubbles (Simple-Modus): manuell startbar aus den Einstellungen.
import { create } from "zustand";

interface OnboardingState {
  /** Onboarding manuell geöffnet („Einrichtung erneut starten“) */
  open: boolean;
  /** Einführungs-Bubbles manuell gestartet */
  tour: boolean;
}

export const useOnboarding = create<OnboardingState>(() => ({ open: false, tour: false }));

export function restartOnboarding() {
  useOnboarding.setState({ open: true });
}

export function startTour() {
  useOnboarding.setState({ tour: true });
}
