// Kurze Benachrichtigungen unten rechts. Aufruf überall: toast.success("…"), toast.error(err).
import { create } from "zustand";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { errorHint } from "@/lib/errorHints";
import { t as tr, useT } from "@/i18n";
import { cn } from "./cn";

type Tone = "info" | "success" | "error";
interface ToastItem {
  id: number;
  tone: Tone;
  title: ReactNode;
  text?: ReactNode;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">, ms?: number) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t, ms = 4500) => {
    const id = nextId++;
    set({ items: [...get().items.slice(-4), { ...t, id }] });
    if (ms > 0) setTimeout(() => get().dismiss(id), ms);
    return id;
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (title: ReactNode, text?: ReactNode, action?: ToastItem["action"], ms?: number) => useToasts.getState().push({ tone: "info", title, text, action }, ms),
  success: (title: ReactNode, text?: ReactNode, action?: ToastItem["action"]) => useToasts.getState().push({ tone: "success", title, text, action }),
  error: (titleOrError: unknown, text?: ReactNode) => {
    const isNode = typeof titleOrError === "string";
    return useToasts.getState().push(
      isNode ? { tone: "error", title: titleOrError as string, text } : { tone: "error", title: text ?? tr("common.error"), text: <ErrorBody error={titleOrError} /> },
      8000,
    );
  },
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};

export function ErrorBody({ error }: { error: unknown }) {
  const raw = errorMessage(error);
  const hint = errorHint(error);
  if (!hint) return <>{raw}</>;
  return (
    <>
      <span className="block text-text/85">{tr(`usab.err.${hint}`)}</span>
      <span className="mt-1 block text-[11.5px] text-dim">{raw}</span>
    </>
  );
}

export function Toaster() {
  const t = useT();
  const closeLabel = t("common.close");
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[360px] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "vl-toast pointer-events-auto flex gap-3 rounded-card bg-overlay px-4 py-3 shadow-e2 animate-slide-up [#root[aria-hidden=true]_&]:pointer-events-none",
          )}
        >
          <span className="mt-0.5">
            {t.tone === "error" ? <AlertTriangle size={16} className="text-danger" /> : t.tone === "success" ? <CheckCircle2 size={16} className="text-ok" /> : <Info size={16} className="text-accent" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{t.title}</div>
            {t.text && <div className="selectable mt-0.5 break-words text-[12px] text-muted">{t.text}</div>}
            {t.action && (
              <button
                className="mt-1.5 text-[12.5px] font-semibold text-accent hover:brightness-125"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            aria-label={closeLabel}
            className="self-start text-dim hover:text-text"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
