import type { Appearance } from "@/lib/types";

export type SetAppearance = (p: Partial<Appearance>, delay?: number) => void;

export interface CardProps {
  a: Appearance;
  set: SetAppearance;
}
