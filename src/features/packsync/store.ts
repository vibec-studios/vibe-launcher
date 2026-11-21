import { create } from "zustand";

export interface DiffTarget {
  instanceId: string;
  code: string;
  toVersionId: string | null;
}

export const usePackDiff = create<{ open: DiffTarget | null }>(() => ({ open: null }));

export const openPackDiff = (t: DiffTarget) => usePackDiff.setState({ open: t });
export const closePackDiff = () => usePackDiff.setState({ open: null });
