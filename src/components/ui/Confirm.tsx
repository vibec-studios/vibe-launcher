// Bestätigungsdialog als Promise: `if (await confirm({ title, text, danger: true })) …`
import { create } from "zustand";
import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { t } from "@/i18n";

interface ConfirmOptions {
  title: ReactNode;
  text?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  opts: ConfirmOptions | null;
  resolve: ((v: boolean) => void) | null;
  open: (o: ConfirmOptions) => Promise<boolean>;
  close: (v: boolean) => void;
}

const useConfirm = create<ConfirmState>((set, get) => ({
  opts: null,
  resolve: null,
  open: (opts) =>
    new Promise<boolean>((resolve) => {
      get().resolve?.(false);
      set({ opts, resolve });
    }),
  close: (v) => {
    get().resolve?.(v);
    set({ opts: null, resolve: null });
  },
}));

export function confirm(o: ConfirmOptions): Promise<boolean> {
  return useConfirm.getState().open(o);
}

export function ConfirmHost() {
  const { opts, close } = useConfirm();
  return (
    <Dialog
      open={!!opts}
      onOpenChange={(o) => !o && close(false)}
      title={opts?.title ?? ""}
      description={opts?.text}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={() => close(false)} autoFocus={!!opts?.danger}>
            {opts?.cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant={opts?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus={!opts?.danger}>
            {opts?.confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    />
  );
}
