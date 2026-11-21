import { create } from "zustand";
import type { Instance, QuickCheck } from "@/lib/types";

export interface FixRequest {
  instanceId: string;
  /** Ausdrücklich gewählter Absturz (Crash-Banner/-Dialog) */
  crashReport?: string | null;
  exitCode?: number | null;
  /** Nach dem Beheben „Jetzt starten“ anbieten */
  launchAfter?: boolean;
}

export type PreChoice = "fix" | "launch" | "cancel";

interface AutofixStore {
  req: FixRequest | null;
  pre: { inst: Instance; q: QuickCheck; resolve: (c: PreChoice) => void } | null;
}

export const useAutofix = create<AutofixStore>(() => ({ req: null, pre: null }));

export function openAutofix(req: FixRequest) {
  useAutofix.setState({ req });
}

/** Rückfrage vor dem Start, wenn bekannte Probleme vorliegen. */
export function askBeforeLaunch(inst: Instance, q: QuickCheck): Promise<PreChoice> {
  return new Promise((resolve) => useAutofix.setState({ pre: { inst, q, resolve } }));
}

/** „Trotzdem starten“ gilt für diese Sitzung, solange sich die Zahl der Probleme nicht ändert. */
const skipped = new Map<string, number>();
export function launchCheckSkipped(id: string, errors: number) {
  return skipped.get(id) === errors;
}

export function skipLaunchCheck(id: string, errors: number) {
  skipped.set(id, errors);
}
