// Einstellungen als Popup: überall per `openSettings("vibe")` öffnen. Die alte Route `/settings?tab=…` leitet hierher um.
import { create } from "zustand";

export const SETTINGS_TABS = ["general", "appearance", "java", "game", "downloads", "vibe", "privacy", "updates", "about"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(v: unknown): v is SettingsTab {
  return typeof v === "string" && (SETTINGS_TABS as readonly string[]).includes(v);
}

interface SettingsDialogState {
  open: boolean;
  tab: SettingsTab;
}

export const useSettingsDialog = create<SettingsDialogState>(() => ({ open: false, tab: "general" }));

/** Öffnet das Einstellungs-Popup (ohne Tab: zuletzt gewählter). */
export function openSettings(tab?: SettingsTab) {
  useSettingsDialog.setState((s) => ({ open: true, tab: tab ?? s.tab }));
}

export function closeSettings() {
  useSettingsDialog.setState({ open: false });
}

export function setSettingsTab(tab: SettingsTab) {
  useSettingsDialog.setState({ tab });
}
