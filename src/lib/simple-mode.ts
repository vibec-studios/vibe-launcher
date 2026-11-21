import type { NavKey } from "./types";
import type { SettingsTab } from "@/features/settings/store";
import type { InstanceSettingsTab } from "@/features/instances/settings/store";
import { useSimple } from "./mode";

export type ExpertFeature =
  | "servers"
  | "java-runtime"
  | "jvm-args"
  | "launch-hooks"
  | "env-vars"
  | "game-logs"
  | "instance-files"
  | "downloads-storage"
  | "api-keys"
  | "custom-stores"
  | "update-channel"
  | "tech-details";

export type InstanceArea = "content" | "worlds" | "logs" | "files" | "backups";

export const SIMPLE_HIDDEN: readonly ExpertFeature[] = [
  "servers",
  "java-runtime",
  "jvm-args",
  "launch-hooks",
  "env-vars",
  "game-logs",
  "instance-files",
  "downloads-storage",
  "api-keys",
  "custom-stores",
  "update-channel",
  "tech-details",
];

const NAV: Partial<Record<NavKey, ExpertFeature>> = { servers: "servers" };
const SETTINGS_TABS: Partial<Record<SettingsTab, ExpertFeature>> = { downloads: "downloads-storage" };
const INSTANCE_TABS: Partial<Record<InstanceSettingsTab, ExpertFeature>> = { java: "java-runtime" };
const INSTANCE_AREAS: Partial<Record<InstanceArea, ExpertFeature>> = { logs: "game-logs", files: "instance-files" };

export function hiddenIn(simple: boolean, feature: ExpertFeature | undefined): boolean {
  return simple && !!feature && SIMPLE_HIDDEN.includes(feature);
}

export const simpleHides = {
  nav: (simple: boolean, k: NavKey) => hiddenIn(simple, NAV[k]),
  settingsTab: (simple: boolean, k: SettingsTab) => hiddenIn(simple, SETTINGS_TABS[k]),
  instanceTab: (simple: boolean, k: InstanceSettingsTab) => hiddenIn(simple, INSTANCE_TABS[k]),
  instanceArea: (simple: boolean, k: InstanceArea) => hiddenIn(simple, INSTANCE_AREAS[k]),
};

export function useExpert(feature: ExpertFeature): boolean {
  return !hiddenIn(useSimple(), feature);
}
