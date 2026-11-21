import { create } from "zustand";
import type { PackInput } from "./api";

export interface PackDialogRequest {
  input?: PackInput | null;
  serverKey?: string | null;
}

interface PackDialogState {
  req: PackDialogRequest | null;
  seq: number;
}

export const usePackDialog = create<PackDialogState>(() => ({ req: null, seq: 0 }));

export function openPackToServer(req: PackDialogRequest = {}) {
  usePackDialog.setState((s) => ({ req, seq: s.seq + 1 }));
}

export function closePackToServer() {
  usePackDialog.setState({ req: null });
}
