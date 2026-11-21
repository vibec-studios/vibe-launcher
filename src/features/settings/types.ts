import type { Settings } from "@/lib/types";

export type Update = (p: Partial<Settings>, delay?: number) => void;

export interface TabProps {
  s: Settings;
  update: Update;
}
