// Bedienmodus: „Simple“ (geführt, ohne Fachbegriffe) oder „Expert“ (alle Funktionen, unverändert).
// Ein zentrales Flag für alles, was Simple ausblendet oder vereinfacht:
//   const simple = useSimple();            // in Komponenten
//   <ExpertOnly>…</ExpertOnly>             // Teile, die es nur im Expert-Modus gibt
// Texte: Schlüssel mit `simple:`-Variante in src/i18n/simple.ts ersetzen Fachbegriffe automatisch (useT/t).
// Gespeichert in den Einstellungen (`ui_mode`); der letzte Wert liegt zusätzlich im Browser-Speicher, damit beim
// Start nichts flackert, bevor die Einstellungen geladen sind.
import { useEffect, type ReactNode } from "react";
import { useLang } from "@/i18n";
import { api } from "./api";
import { qk, queryClient, useSettings } from "./queries";
import type { Settings, UiMode } from "./types";

export type { UiMode };

const CACHE_KEY = "vl.mode";

function cached(): UiMode {
  try {
    return localStorage.getItem(CACHE_KEY) === "simple" ? "simple" : "expert";
  } catch {
    return "expert";
  }
}

export function useMode(): UiMode {
  const mode = useSettings().data?.ui_mode;
  return mode ?? cached();
}

export function useSimple(): boolean {
  return useMode() === "simple";
}

/** Nur im Expert-Modus zeigen. */
export function ExpertOnly({ children }: { children: ReactNode }) {
  return useSimple() ? null : <>{children}</>;
}

/** Nur im Simple-Modus zeigen. */
export function SimpleOnly({ children }: { children: ReactNode }) {
  return useSimple() ? <>{children}</> : null;
}

/** Einstellungen teilweise speichern (außerhalb des Einstellungs-Dialogs). */
export async function patchSettings(p: Partial<Settings>): Promise<Settings | undefined> {
  const base = queryClient.getQueryData<Settings>(qk.settings) ?? (await api.settingsGet());
  const next = await api.settingsSet({ ...base, ...p });
  queryClient.setQueryData(qk.settings, next);
  return next;
}

export function setMode(mode: UiMode) {
  applyModeNow(mode);
  return patchSettings({ ui_mode: mode });
}

/** Sofort umschalten (Texte, Seitenleiste), noch bevor das Backend antwortet. */
function applyModeNow(mode: UiMode) {
  try {
    localStorage.setItem(CACHE_KEY, mode);
  } catch {
    /* egal */
  }
  useLang.setState({ simple: mode === "simple" });
  document.documentElement.dataset.mode = mode;
}

/** Hält Texte (`simple:`-Varianten), `data-mode` am Wurzelelement und den Cache aktuell. Einmal in der Shell. */
export function ModeHost() {
  const mode = useMode();
  useEffect(() => applyModeNow(mode), [mode]);
  return null;
}
