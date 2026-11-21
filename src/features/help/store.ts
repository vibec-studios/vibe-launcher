import { create } from "zustand";
import type { GuideId, TourId } from "./types";
import type { TermId } from "./glossary/terms";
import { startTour } from "./tour/store";

export type HelpView = GuideId | "tours" | "glossary";

interface HelpState {
  open: boolean;
  view: HelpView;
  term?: TermId;
}

export const useHelp = create<HelpState>(() => ({ open: false, view: "tours" }));

export function openHelp(view: HelpView = "tours", term?: TermId) {
  useHelp.setState({ open: true, view, term });
}

export function closeHelp() {
  useHelp.setState({ open: false });
}

export function launchTour(id: TourId, resume = false) {
  closeHelp();
  window.setTimeout(() => startTour(id, { resume }), 180);
}
