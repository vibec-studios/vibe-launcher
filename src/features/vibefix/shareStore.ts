import { create } from "zustand";

export interface ShareRequest {
  instanceId: string;
  crashReport: string | null;
}

export const useShareLog = create<{ req: ShareRequest | null }>(() => ({ req: null }));

export function openShareLog(instanceId: string, crashReport: string | null) {
  useShareLog.setState({ req: { instanceId, crashReport } });
}

export function closeShareLog() {
  useShareLog.setState({ req: null });
}
