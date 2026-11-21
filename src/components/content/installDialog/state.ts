import { create } from "zustand";

export type Phase =
  | { k: "select" }
  | { k: "running"; taskId: string }
  | { k: "done"; instanceId: string }
  | { k: "error"; message: string };

/** Wie der letzte Start lief (manuell: Dateiseite geöffnet bzw. nur vorgemerkt) – für den Abschlusstext. */
export const useManualMode = create<{ mode: "open" | "add" | null }>(() => ({ mode: null }));

// Die Auswahl-Komponenten legen ihren "Start"-Knopf über ein Portal-Ziel in den Footer – einfacher:
// Footer liest den aktuellen Start-Handler aus diesem kleinen Store.
export const useStartAction = create<{
  run: (() => void) | null;
  disabled: boolean;
  busy: boolean;
  label: string;
  /** Manueller Download: Haupt-Knopf öffnet CurseForge */
  manual?: boolean;
  /** Zweiter Knopf (manuell: „Zur Instanz hinzufügen“) */
  alt?: { label: string; run: () => void } | null;
}>(() => ({
  run: null,
  disabled: true,
  busy: false,
  label: "",
}));
