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

export function openInstanceSettings(instanceId: string, tab?: InstanceSettingsTab) {
  useInstanceSettings.setState((s) => ({ instanceId, tab: tab ?? (s.instanceId === instanceId ? s.tab : "general") }));
}

export function closeInstanceSettings() {
  useInstanceSettings.setState({ instanceId: null });
}

export function setInstanceSettingsTab(tab: InstanceSettingsTab) {
  useInstanceSettings.setState({ tab });
}
