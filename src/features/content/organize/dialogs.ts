import { create } from "zustand";
import type { ReactNode } from "react";
import type { OrgGroup, RemovalExtra, Target } from "./api";

export type OrgDialog =
  | { type: "group"; group?: OrgGroup; targets?: Target[] }
  | { type: "tags"; targets: Target[]; names: string[] }
  | { type: "cleanup" }
  | { type: "remove"; title: ReactNode; text: ReactNode; extras: RemovalExtra[]; resolve: (v: RemovalExtra[] | null) => void };

interface DialogState {
  dialog: OrgDialog | null;
  open: (d: OrgDialog) => void;
  close: () => void;
}

export const useOrgDialog = create<DialogState>((set, get) => ({
  dialog: null,
  open: (dialog) => {
    const cur = get().dialog;
    if (cur?.type === "remove") cur.resolve(null);
    set({ dialog });
  },
  close: () => {
    const cur = get().dialog;
    if (cur?.type === "remove") cur.resolve(null);
    set({ dialog: null });
  },
}));

export const openOrgDialog = (d: OrgDialog) => useOrgDialog.getState().open(d);

export function askRemoveWithExtras(title: ReactNode, text: ReactNode, extras: RemovalExtra[]): Promise<RemovalExtra[] | null> {
  return new Promise((resolve) => openOrgDialog({ type: "remove", title, text, extras, resolve }));
}

export function settleRemove(value: RemovalExtra[] | null) {
  const cur = useOrgDialog.getState().dialog;
  if (cur?.type !== "remove") return;
  cur.resolve(value);
  useOrgDialog.setState({ dialog: null });
}
