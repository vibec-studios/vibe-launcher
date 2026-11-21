import { create } from "zustand";
import type { GuideId, TourId } from "./types";
import { startTour } from "./tour/store";

export type HelpView = GuideId | "tours";

interface HelpState {
  open: boolean;
  view: HelpView;
}

export const useHelp = create<HelpState>(() => ({ open: false, view: "tours" }));

export function openHelp(view: HelpView = "tours") {
  useHelp.setState({ open: true, view });
}

export function closeHelp() {
  useHelp.setState({ open: false });
}

export function launchTour(id: TourId, resume = false) {
  closeHelp();
  window.setTimeout(() => startTour(id, { resume }), 180);
}
