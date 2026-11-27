import { create } from "zustand";

export interface FixRequest {
  instanceId: string;
  /** Ausdrücklich gewählter Absturz (Crash-Banner/-Dialog) */
  crashReport?: string | null;
  exitCode?: number | null;
  /** Nach dem Beheben „Jetzt starten“ anbieten */
  launchAfter?: boolean;
}

interface AutofixStore {
  req: FixRequest | null;
}

export const useAutofix = create<AutofixStore>(() => ({ req: null }));

export function openAutofix(req: FixRequest) {
  useAutofix.setState({ req });
}
