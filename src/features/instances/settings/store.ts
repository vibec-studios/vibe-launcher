// Instanz-Einstellungen als Popup: `openInstanceSettings(id, tab)` (Zahnrad auf der Instanzseite, Deep-Link
// `?tab=settings`, Vibey-Symbol im Kopf …).
import { create } from "zustand";

export const INSTANCE_SETTINGS_TABS = ["general", "version", "client", "java", "launch", "sync", "vibe", "advanced"] as const;
export type InstanceSettingsTab = (typeof INSTANCE_SETTINGS_TABS)[number];

interface State {
  instanceId: string | null;
  tab: InstanceSettingsTab;
}

export const useInstanceSettings = create<State>(() => ({ instanceId: null, tab: "general" }));
let settingsTrigger: HTMLElement | null = null;

export function openInstanceSettings(instanceId: string, tab?: InstanceSettingsTab) {
  const current = useInstanceSettings.getState();
  if (current.instanceId === null) {
    const active = document.activeElement;
    settingsTrigger = active instanceof HTMLElement ? active : null;
  }
  useInstanceSettings.setState({ instanceId, tab: tab ?? (current.instanceId === instanceId ? current.tab : "general") });
}

export function closeInstanceSettings() {
  useInstanceSettings.setState({ instanceId: null });
}

export function restoreInstanceSettingsFocus() {
  if (useInstanceSettings.getState().instanceId !== null) return;
  settingsTrigger?.focus({ preventScroll: true });
  settingsTrigger = null;
}

export function setInstanceSettingsTab(tab: InstanceSettingsTab) {
  useInstanceSettings.setState({ tab });
}
